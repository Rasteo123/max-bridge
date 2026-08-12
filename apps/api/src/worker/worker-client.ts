import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";

import {
  FrameDecoder,
  encodeFrame,
  parseWorkerMessage,
  type WorkerOperation,
  type WorkerEvent,
  type WorkerResponse
} from "@maxbridge/protocol";

export class WorkerUnavailableError extends Error {
  readonly code = "worker_unavailable";

  constructor() {
    super("Worker is unavailable");
    this.name = "WorkerUnavailableError";
  }
}

export class RequestTimeoutError extends Error {
  readonly code = "worker_request_timeout";

  constructor() {
    super("Worker request timed out");
    this.name = "RequestTimeoutError";
  }
}

export class WorkerRequestError extends Error {
  constructor(readonly code: string) {
    super("Worker request failed");
    this.name = "WorkerRequestError";
  }
}

export type WorkerClientOptions = Readonly<{
  socketPath: string;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}>;

export type WorkerClientRequest = Readonly<{
  operation: WorkerOperation;
  sessionHandle: string;
  payload?: unknown;
}>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class WorkerClient {
  private socket: Socket | undefined;
  private connecting: Promise<void> | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectDelayMs: number;
  private stopped = false;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly listeners = new Set<(event: WorkerEvent) => void>();
  private readonly connectionListeners = new Set<
    (connected: boolean) => void
  >();
  private connected = false;

  constructor(private readonly options: WorkerClientOptions) {
    // Worker operations may include a 15-second MAX UI state transition.
    // Keep the transport deadline safely above the operation deadline.
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.initialReconnectDelayMs = options.reconnectDelayMs ?? 250;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 5_000;
    this.reconnectDelayMs = this.initialReconnectDelayMs;
  }

  connect(): Promise<void> {
    if (this.socket !== undefined) {
      return Promise.resolve();
    }
    this.connecting ??= this.openSocket().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async openSocket(): Promise<void> {
    // A dropped connection can leave a partial frame behind; the new socket
    // must not inherit it.
    this.decoder.reset();
    const socket = connect(this.options.socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.removeAllListeners("error");
    socket.on("data", (chunk) => {
      if (typeof chunk === "string") {
        socket.destroy();
        return;
      }
      this.handleChunk(chunk);
    });
    socket.on("error", () => {
      this.handleDisconnect();
    });
    socket.on("close", () => {
      this.handleDisconnect();
    });
    this.socket = socket;
    this.connected = true;
    this.reconnectDelayMs = this.initialReconnectDelayMs;
    for (const listener of this.connectionListeners) {
      listener(true);
    }
  }

  async request(request: WorkerClientRequest): Promise<unknown> {
    if (this.socket === undefined || this.socket.destroyed) {
      // The worker restarts on deploy; a request arriving in that window
      // reconnects rather than failing the caller outright.
      await this.connect().catch(() => undefined);
    }
    const socket = this.socket;
    if (socket === undefined || socket.destroyed) {
      throw new WorkerUnavailableError();
    }
    const requestId = `r_${randomBytes(16).toString("base64url")}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new RequestTimeoutError());
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        socket.write(encodeFrame({
          kind: "request",
          requestId,
          operation: request.operation,
          sessionHandle: request.sessionHandle,
          ...("payload" in request ? { payload: request.payload } : {})
        }));
      } catch {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(new WorkerUnavailableError());
      }
    });
  }

  subscribe(listener: (event: WorkerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeConnection(
    listener: (connected: boolean) => void
  ): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  isConnected(): boolean {
    return this.connected
      && this.socket !== undefined
      && !this.socket.destroyed;
  }

  /** Stops reconnecting: the process is shutting down. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.destroy();
    this.handleDisconnect();
  }

  private handleChunk(chunk: Uint8Array): void {
    try {
      for (const value of this.decoder.push(chunk)) {
        const message = parseWorkerMessage(value);
        if (message.kind === "response") {
          this.resolveResponse(message);
        } else if (message.kind === "event") {
          for (const listener of this.listeners) {
            listener(message);
          }
        }
      }
    } catch {
      this.socket?.destroy();
      this.handleDisconnect();
    }
  }

  private resolveResponse(response: WorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(response.requestId);
    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      pending.reject(new WorkerRequestError(response.errorCode));
    }
  }

  private handleDisconnect(): void {
    this.socket = undefined;
    if (this.connected) {
      this.connected = false;
      for (const listener of this.connectionListeners) {
        listener(false);
      }
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new WorkerUnavailableError());
    }
    this.pending.clear();
    this.scheduleReconnect();
  }

  /**
   * Without this the API stayed dead to the worker after any restart, and
   * every request failed until the API itself was restarted by hand.
   */
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      this.maxReconnectDelayMs,
      this.reconnectDelayMs * 2
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref();
  }
}
