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
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly listeners = new Set<(event: WorkerEvent) => void>();

  constructor(private readonly options: WorkerClientOptions) {
    // Worker operations may include a 15-second MAX UI state transition.
    // Keep the transport deadline safely above the operation deadline.
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async connect(): Promise<void> {
    if (this.socket !== undefined) {
      return;
    }
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
  }

  request(request: WorkerClientRequest): Promise<unknown> {
    const socket = this.socket;
    if (socket === undefined || socket.destroyed) {
      return Promise.reject(new WorkerUnavailableError());
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

  close(): void {
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new WorkerUnavailableError());
    }
    this.pending.clear();
  }
}
