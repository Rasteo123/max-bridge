import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  MAX_SOCKET_ORIGIN,
  MAX_WIRE_INIT_SCRIPT,
  MAX_WIRE_SEND_KEY
} from "./max-wire-client.js";

type FakeSocket = {
  url: string;
  readyState: number;
  sent: ArrayBuffer[];
  send(data: ArrayBuffer): void;
};

/**
 * Runs the init script the way the browser does — as an expression, against a
 * WebSocket stand-in — so the hook is exercised without a real page.
 */
function installHook() {
  const sockets: FakeSocket[] = [];
  class FakeWebSocket implements FakeSocket {
    static readonly OPEN = 1;
    readonly sent: ArrayBuffer[] = [];
    readyState = 1;

    constructor(readonly url: string) {
      sockets.push(this);
    }

    send(data: ArrayBuffer): void {
      this.sent.push(data);
    }
  }

  // Symbol-keyed globals do not surface on the sandbox object, so the hook is
  // always reached from inside the context.
  const context = createContext({ WebSocket: FakeWebSocket });
  const sender = `globalThis[Symbol.for(${
    JSON.stringify(MAX_WIRE_SEND_KEY)
  })]`;
  const outcome = runInContext(MAX_WIRE_INIT_SCRIPT, context) as string;
  return {
    outcome,
    context,
    sockets,
    reinstall: (): string =>
      runInContext(MAX_WIRE_INIT_SCRIPT, context) as string,
    run: (source: string): unknown => runInContext(source, context),
    hasSender: (): boolean =>
      runInContext(`typeof ${sender}`, context) === "function",
    connect: (url: string): FakeSocket =>
      runInContext(
        `new WebSocket(${JSON.stringify(url)})`,
        context
      ) as FakeSocket,
    send: (bytes: readonly number[]): boolean =>
      runInContext(
        `${sender}(${JSON.stringify(bytes)})`,
        context
      ) as boolean
  };
}

describe("MAX_WIRE_INIT_SCRIPT", () => {
  it("evaluates as an expression and exposes the sender", () => {
    const hook = installHook();

    expect(hook.outcome).toBe("installed");
    expect(hook.hasSender()).toBe(true);
  });

  it("claims the socket as it is constructed, before any traffic", () => {
    const hook = installHook();
    const socket = hook.connect(`${MAX_SOCKET_ORIGIN}/websocket`);

    // No send has happened yet: capture-on-construct is the whole point,
    // because MAX only pings every thirty seconds or so.
    expect(hook.send([1, 2, 3])).toBe(true);
    expect(socket.sent).toHaveLength(1);
    expect([...new Uint8Array(socket.sent[0] as ArrayBuffer)])
      .toEqual([1, 2, 3]);
  });

  it("ignores sockets that do not belong to MAX", () => {
    const hook = installHook();
    hook.connect("wss://telemetry.example.com/socket");

    expect(hook.send([1])).toBe(false);
  });

  it("reports a closed socket instead of sending into it", () => {
    const hook = installHook();
    const socket = hook.connect(`${MAX_SOCKET_ORIGIN}/websocket`);
    socket.readyState = 3;

    expect(hook.send([1])).toBe(false);
  });

  it("also recovers a socket that only reveals itself by sending", () => {
    const hook = installHook();
    // A socket built before the hook existed never runs the construct trap,
    // so its first send is the only chance to claim it.
    hook.run(`
      globalThis.legacy = Object.create(WebSocket.prototype);
      legacy.url = ${JSON.stringify(`${MAX_SOCKET_ORIGIN}/websocket`)};
      legacy.readyState = 1;
      legacy.sent = [];
      legacy.send(new Uint8Array([9]).buffer)
    `);

    expect(hook.send([7])).toBe(true);
    expect(hook.run("legacy.sent.length")).toBe(2);
  });

  it("stays inert when installed twice", () => {
    const hook = installHook();

    expect(hook.reinstall()).toBe("present");
  });
});
