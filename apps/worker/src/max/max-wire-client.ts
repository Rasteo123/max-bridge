import {
  encodeMaxFrame,
  type DecodedMaxFrame
} from "@maxbridge/max-adapter";
import type { Page } from "playwright";

export const MAX_WIRE_SEND_KEY = "maxbridge.wire-send.v1";
export const MAX_SOCKET_ORIGIN = "wss://api.oneme.ru";

const REQUEST_COMMAND = 0;
const RESPONSE_COMMAND = 1;
const DEFAULT_TIMEOUT_MS = 12_000;
const SOCKET_WAIT_MS = 8_000;
const SOCKET_POLL_MS = 100;
// The MAX client numbers its own frames from 1 upward, so bridge requests use
// a high band that it will not reach within a connection.
const FIRST_SEQUENCE = 40_000;
const LAST_SEQUENCE = 60_000;

// Installed before the MAX bundle runs so the authenticated socket is captured
// the first time the client sends anything on it.
export const MAX_WIRE_INIT_SCRIPT = `(() => {
  var key = Symbol.for(${JSON.stringify(MAX_WIRE_SEND_KEY)});
  if (globalThis[key] !== undefined) { return; }
  var origin = ${JSON.stringify(MAX_SOCKET_ORIGIN)};
  var socket = null;
  var send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof this.url === "string" && this.url.indexOf(origin) === 0) {
        socket = this;
      }
    } catch (error) { void error; }
    return send.call(this, data);
  };
  globalThis[key] = function (bytes) {
    if (socket === null || socket.readyState !== 1) { return false; }
    send.call(socket, new Uint8Array(bytes).buffer);
    return true;
  };
})();`;

export class MaxWireError extends Error {
  constructor(
    message: string,
    readonly reason: "unavailable" | "timeout" | "rejected"
  ) {
    super(message);
    this.name = "MaxWireError";
  }
}

type PendingRequest = Readonly<{
  opcode: number;
  resolve(payload: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}>;

export class MaxWireClient {
  private sequence = FIRST_SEQUENCE;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly page: Page) {}

  /**
   * Resolves the matching request when a response frame arrives. Returns true
   * when the frame belonged to this client so callers can skip further work.
   */
  ingest(frame: DecodedMaxFrame): boolean {
    if (frame.command !== RESPONSE_COMMAND) {
      return false;
    }
    const request = this.pending.get(frame.sequence);
    if (request === undefined) {
      return false;
    }
    this.pending.delete(frame.sequence);
    clearTimeout(request.timer);
    request.resolve(frame.payload);
    return true;
  }

  async request(
    opcode: number,
    payload?: unknown,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<unknown> {
    const sequence = this.nextSequence();
    const frame = encodeMaxFrame({
      command: REQUEST_COMMAND,
      sequence,
      opcode,
      ...(payload === undefined ? {} : { payload })
    });

    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequence);
        reject(new MaxWireError(
          `MAX opcode ${String(opcode)} timed out`,
          "timeout"
        ));
      }, timeoutMs);
      timer.unref();
      this.pending.set(sequence, { opcode, resolve, reject, timer });
    });

    try {
      await this.transmit(frame);
    } catch (error: unknown) {
      const request = this.pending.get(sequence);
      if (request !== undefined) {
        this.pending.delete(sequence);
        clearTimeout(request.timer);
      }
      throw error;
    }
    return response;
  }

  reset(reason: string): void {
    for (const [sequence, request] of this.pending) {
      this.pending.delete(sequence);
      clearTimeout(request.timer);
      request.reject(new MaxWireError(reason, "unavailable"));
    }
  }

  private nextSequence(): number {
    this.sequence = this.sequence >= LAST_SEQUENCE
      ? FIRST_SEQUENCE
      : this.sequence + 1;
    return this.sequence;
  }

  private async transmit(frame: Uint8Array): Promise<void> {
    const bytes = [...frame];
    const deadline = Date.now() + SOCKET_WAIT_MS;
    for (;;) {
      const delivered = await this.page.evaluate(
        (input) => {
          const send = (
            globalThis as Record<PropertyKey, unknown>
          )[Symbol.for(input.key)];
          return typeof send === "function"
            ? (send as (value: readonly number[]) => boolean)(input.bytes)
            : false;
        },
        { key: MAX_WIRE_SEND_KEY, bytes }
      );
      if (delivered) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new MaxWireError(
          "MAX socket is unavailable",
          "unavailable"
        );
      }
      await this.page.waitForTimeout(SOCKET_POLL_MS);
    }
  }
}
