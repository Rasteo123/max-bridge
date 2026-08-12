import { createContext, runInContext } from "node:vm";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";

import {
  MaxWireClient,
  MaxWireError,
  MAX_SOCKET_ORIGIN,
  MAX_WIRE_INIT_SCRIPT,
  MAX_WIRE_SEND_KEY
} from "./max-wire-client.js";

type FakeSocket = {
  url: string;
  readyState: number;
  sent: ArrayBuffer[];
  closeListeners: ((event: unknown) => void)[];
  addEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: ArrayBuffer): void;
};

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * Runs the init script the way the browser does — as an expression, against a
 * WebSocket stand-in — so the hook is exercised without a real page.
 */
function installHook() {
  const sockets: FakeSocket[] = [];
  class FakeWebSocket implements FakeSocket {
    static readonly OPEN = 1;
    readonly sent: ArrayBuffer[] = [];
    readonly closeListeners: ((event: unknown) => void)[] = [];
    readyState = 1;

    constructor(readonly url: string) {
      sockets.push(this);
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
      if (type === "close") {
        this.closeListeners.push(listener);
      }
    }

    send(data: ArrayBuffer): void {
      this.sent.push(data);
    }
  }

  // Symbol-keyed globals do not surface on the sandbox object, so the hook is
  // always reached from inside the context.
  const listeners: string[] = [];
  const document = {
    visibilityState: "hidden",
    hidden: true,
    addEventListener: (type: string) => {
      listeners.push(type);
    }
  };
  const context = createContext({ WebSocket: FakeWebSocket, document });
  const sender = `globalThis[Symbol.for(${
    JSON.stringify(MAX_WIRE_SEND_KEY)
  })]`;
  const outcome = runInContext(MAX_WIRE_INIT_SCRIPT, context) as string;
  return {
    outcome,
    context,
    sockets,
    listeners,
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
    lastClose: (): unknown =>
      runInContext(`${sender}("lastClose")`, context),
    send: (bytes: readonly number[]): string =>
      runInContext(
        `${sender}(${JSON.stringify(bytes)})`,
        context
      ) as string
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
    expect(hook.send([1, 2, 3])).toBe("sent");
    expect(socket.sent).toHaveLength(1);
    expect([...new Uint8Array(socket.sent[0] as ArrayBuffer)])
      .toEqual([1, 2, 3]);
  });

  it("ignores sockets that do not belong to MAX", () => {
    const hook = installHook();
    hook.connect("wss://telemetry.example.com/socket");

    expect(hook.send([1])).toBe("absent");
  });

  it("reports a closed socket instead of sending into it", () => {
    const hook = installHook();
    const socket = hook.connect(`${MAX_SOCKET_ORIGIN}/websocket`);
    socket.readyState = 3;

    expect(hook.send([1])).toBe("closed");
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

    expect(hook.send([7])).toBe("sent");
    expect(hook.run("legacy.sent.length")).toBe(2);
  });

  it("keeps the tab reported as visible so MAX holds the socket open", () => {
    const hook = installHook();

    expect(hook.run("document.visibilityState")).toBe("visible");
    expect(hook.run("document.hidden")).toBe(false);
    expect(hook.listeners).toContain("visibilitychange");
  });

  it("records how MAX closed the socket", () => {
    const hook = installHook();
    const socket = hook.connect(`${MAX_SOCKET_ORIGIN}/websocket`);

    expect(hook.lastClose()).toBeNull();

    socket.readyState = 3;
    for (const listener of socket.closeListeners) {
      listener({ code: 1008, reason: "policy", wasClean: false });
    }

    expect(hook.lastClose()).toMatchObject({
      code: 1008,
      reason: "policy",
      wasClean: false
    });
  });

  it("stays inert when installed twice", () => {
    const hook = installHook();

    expect(hook.reinstall()).toBe("present");
  });
});

describe("MaxWireClient", () => {
  it("does not emit an unhandled rejection while transmit is still waiting", async () => {
    const transmitWait = deferred();
    let sendAttempts = 0;
    const page = {
      evaluate: () => {
        sendAttempts += 1;
        return Promise.resolve(sendAttempts === 1 ? "absent" : "sent");
      },
      waitForTimeout: () => transmitWait.promise
    } as unknown as Page;
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const outcome = new MaxWireClient(page).request(83, undefined, 5).then(
        (value) => ({ status: "fulfilled", value } as const),
        (reason: unknown) => ({ status: "rejected", reason } as const)
      );

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });
      transmitWait.resolve();

      const result = await outcome;
      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") {
        throw new Error("Expected request to reject");
      }
      expect(result.reason).toBeInstanceOf(MaxWireError);
      if (!(result.reason instanceof MaxWireError)) {
        throw new Error("Expected a MaxWireError");
      }
      expect(result.reason.reason).toBe("timeout");
      expect(unhandledRejections).toEqual([]);
    } finally {
      transmitWait.resolve();
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("keeps the response timeout when transmit fails later", async () => {
    let sendAttempts = 0;
    let socketDeadlinePassed = false;
    const now = vi.spyOn(Date, "now").mockImplementation(() =>
      socketDeadlinePassed ? 16_000 : 0
    );
    const page = {
      evaluate: () => {
        sendAttempts += 1;
        return Promise.resolve(sendAttempts === 1 ? "absent" : "closed");
      },
      waitForTimeout: () => new Promise<void>((resolve) => {
        setTimeout(() => {
          socketDeadlinePassed = true;
          resolve();
        }, 20);
      })
    } as unknown as Page;

    try {
      const result = await new MaxWireClient(page)
        .request(83, undefined, 5)
        .then(
          () => null,
          (reason: unknown) => reason
        );

      expect(result).toBeInstanceOf(MaxWireError);
      expect((result as MaxWireError).reason).toBe("timeout");
    } finally {
      now.mockRestore();
    }
  });
});
