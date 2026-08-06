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
const SOCKET_WAIT_MS = 15_000;
const SOCKET_POLL_MS = 100;
// The MAX client numbers its own frames from 1 upward, so bridge requests use
// a high band that it will not reach within a connection.
const FIRST_SEQUENCE = 40_000;
const LAST_SEQUENCE = 60_000;

// Installed before the MAX bundle runs. The socket is claimed as it is
// constructed rather than on its first send: MAX pings roughly every thirty
// seconds, so waiting for traffic would routinely miss the whole window.
// Patching `send` as well recovers the socket on a page that was already
// running when the session attached.
// Evaluated as an expression, so it must not end in a semicolon.
export const MAX_WIRE_INIT_SCRIPT = `(() => {
  var key = Symbol.for(${JSON.stringify(MAX_WIRE_SEND_KEY)});
  if (globalThis[key] !== undefined) { return "present"; }
  var origin = ${JSON.stringify(MAX_SOCKET_ORIGIN)};
  var Native = globalThis.WebSocket;
  var nativeSend = Native.prototype.send;
  var socket = null;
  // A bridge tab is never looked at, and MAX drops its socket once it decides
  // the tab is in the background. Pin it visible so the connection survives
  // between requests.
  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: function () { return "visible"; }
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: function () { return false; }
    });
    document.addEventListener("visibilitychange", function (event) {
      event.stopImmediatePropagation();
    }, true);
  } catch (error) { void error; }
  function remember(candidate, url) {
    try {
      if (typeof url === "string" && url.indexOf(origin) === 0) {
        socket = candidate;
      }
    } catch (error) { void error; }
  }
  globalThis.WebSocket = new Proxy(Native, {
    construct: function (target, args) {
      var instance = Reflect.construct(target, args);
      remember(instance, args[0]);
      return instance;
    }
  });
  Native.prototype.send = function (data) {
    remember(this, this.url);
    return nativeSend.call(this, data);
  };
  globalThis[key] = function (bytes) {
    if (socket === null) { return "absent"; }
    if (socket.readyState === 0) { return "connecting"; }
    if (socket.readyState === 2) { return "closing"; }
    if (socket.readyState !== 1) { return "closed"; }
    // A null payload asks for the status only; nothing reaches MAX.
    if (bytes === null) { return "open"; }
    nativeSend.call(socket, new Uint8Array(bytes).buffer);
    return "sent";
  };
  return "installed"
})()`;

/** What the in-page sender reports back for a single attempt. */
export type WireSendOutcome =
  | "sent"
  | "open"
  | "absent"
  | "connecting"
  | "closing"
  | "closed"
  | "unhooked";

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

  /**
   * Reports what a send would do right now without sending anything, so the
   * transport can be watched without the Mini App driving it.
   */
  probe(): Promise<WireSendOutcome> {
    return this.page.evaluate((key) => {
      const send = (
        globalThis as Record<PropertyKey, unknown>
      )[Symbol.for(key)];
      if (typeof send !== "function") {
        return "unhooked" as const;
      }
      return (send as (value: readonly number[] | null) => WireSendOutcome)(
        null
      );
    }, MAX_WIRE_SEND_KEY);
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
    let installed = false;
    for (;;) {
      const outcome = await this.page.evaluate(
        (input) => {
          const send = (
            globalThis as Record<PropertyKey, unknown>
          )[Symbol.for(input.key)];
          if (typeof send !== "function") {
            return "unhooked" as const;
          }
          return (
            send as (value: readonly number[]) => WireSendOutcome
          )(input.bytes);
        },
        { key: MAX_WIRE_SEND_KEY, bytes }
      );
      if (outcome === "sent") {
        return;
      }
      // A page that was already loaded when the session attached never ran the
      // init script, so install the hook in place and let the next socket the
      // client opens hand itself over.
      if (outcome === "unhooked" && !installed) {
        installed = true;
        await this.page.evaluate(MAX_WIRE_INIT_SCRIPT);
      }
      if (Date.now() >= deadline) {
        throw new MaxWireError(
          `MAX socket is ${outcome}`,
          "unavailable"
        );
      }
      await this.page.waitForTimeout(SOCKET_POLL_MS);
    }
  }
}
