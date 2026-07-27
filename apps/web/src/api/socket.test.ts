// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedSocket } from "./socket.js";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe("AuthenticatedSocket", () => {
  it("pauses without expiring auth and resumes once with current init data", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    let initData = "first-signed-data";
    const authenticate = vi.fn().mockResolvedValue(undefined);
    const onAuthenticationExpired = vi.fn();
    const onStatus = vi.fn();
    const bridge = new AuthenticatedSocket({
      initData: () => initData,
      authenticate,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      reconnectDelayMs: 10,
      onAuthenticationExpired,
      onStatus
    });

    bridge.start();
    bridge.pause();
    await vi.runAllTimersAsync();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.close).toHaveBeenCalledWith(1_000, "client_pause");
    expect(onAuthenticationExpired).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith("disconnected");

    initData = "current-signed-data";
    await Promise.all([bridge.resume(), bridge.resume()]);

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith("current-signed-data");
    expect(sockets).toHaveLength(2);

    await bridge.resume();
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(2);
    bridge.stop();
  });

  it("cancels a pending reconnect while paused", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const bridge = new AuthenticatedSocket({
      initData: () => "signed-live-init-data",
      authenticate: vi.fn().mockResolvedValue(undefined),
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      reconnectDelayMs: 10
    });

    bridge.start();
    sockets[0]?.emitClose(1_006);
    bridge.pause();
    await vi.runAllTimersAsync();

    expect(sockets).toHaveLength(1);
    bridge.stop();
  });

  it("stays paused when deactivated again during resume authentication", async () => {
    let resolveAuthentication: (() => void) | undefined;
    const authenticate = vi.fn(() => new Promise<void>((resolve) => {
      resolveAuthentication = resolve;
    }));
    const sockets: FakeSocket[] = [];
    const onStatus = vi.fn();
    const bridge = new AuthenticatedSocket({
      initData: () => "current-signed-data",
      authenticate,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onStatus
    });

    bridge.start();
    bridge.pause();
    const resume = bridge.resume();
    bridge.pause();
    resolveAuthentication?.();

    await expect(resume).resolves.toBe(false);
    expect(sockets).toHaveLength(1);
    expect(onStatus.mock.calls.filter(([status]) =>
      status === "disconnected"
    )).toHaveLength(1);
    bridge.stop();
  });

  it("honors a later activation after a stale resume authentication", async () => {
    let initData = "first-signed-data";
    let resolveFirstAuthentication: (() => void) | undefined;
    const authenticate = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstAuthentication = resolve;
      }))
      .mockResolvedValueOnce(undefined);
    const sockets: FakeSocket[] = [];
    const bridge = new AuthenticatedSocket({
      initData: () => initData,
      authenticate,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      }
    });

    bridge.start();
    bridge.pause();
    const staleResume = bridge.resume();
    bridge.pause();
    initData = "latest-signed-data";
    const latestResume = bridge.resume();
    resolveFirstAuthentication?.();

    await expect(staleResume).resolves.toBe(false);
    await expect(latestResume).resolves.toBe(true);
    expect(authenticate).toHaveBeenNthCalledWith(1, "first-signed-data");
    expect(authenticate).toHaveBeenNthCalledWith(2, "latest-signed-data");
    expect(sockets).toHaveLength(2);
    bridge.stop();
  });

  it("reauthenticates from current Telegram initData without browser tokens", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const authenticate = vi.fn().mockResolvedValue(undefined);
    const createSocket = vi.fn(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    const bridge = new AuthenticatedSocket({
      initData: () => "signed-live-init-data",
      authenticate,
      createSocket,
      reconnectDelayMs: 10
    });

    bridge.start();
    sockets[0]?.emitClose(1_008);
    await vi.runAllTimersAsync();

    expect(authenticate).toHaveBeenCalledWith("signed-live-init-data");
    expect(createSocket).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/ws$/u)
    );
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    bridge.stop();
  });

  it("stops retrying when Telegram rejects expired init data", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const expired = new Error("expired");
    const authenticate = vi.fn().mockRejectedValue(expired);
    const onAuthenticationExpired = vi.fn();
    const onStatus = vi.fn();
    const bridge = new AuthenticatedSocket({
      initData: () => "expired-init-data",
      authenticate,
      isAuthenticationRejected: (error) => error === expired,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      reconnectDelayMs: 10,
      onAuthenticationExpired,
      onStatus
    });

    bridge.start();
    sockets[0]?.emitClose(4_401);
    await vi.runAllTimersAsync();

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(onAuthenticationExpired).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith("disconnected");
    expect(sockets).toHaveLength(1);
  });

  it("uses bounded backoff and reports a prolonged disconnect", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const onStatus = vi.fn();
    const bridge = new AuthenticatedSocket({
      initData: () => "signed-live-init-data",
      authenticate: vi.fn().mockResolvedValue(undefined),
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      reconnectDelayMs: 10,
      maxReconnectDelayMs: 40,
      onStatus
    });

    bridge.start();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      sockets[attempt]?.emitClose(1_006);
      await vi.runOnlyPendingTimersAsync();
    }

    expect(sockets).toHaveLength(6);
    expect(onStatus).toHaveBeenCalledWith("disconnected");
    bridge.stop();
  });
});

class FakeSocket {
  private openListener: (() => void) | undefined;
  private closeListener: ((event: CloseEvent) => void) | undefined;

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    if (type === "open" && typeof listener === "function") {
      this.openListener = listener as () => void;
    }
    if (type === "close" && typeof listener === "function") {
      this.closeListener = listener;
    }
  }

  close = vi.fn();

  emitClose(code: number): void {
    this.closeListener?.({ code } as CloseEvent);
  }

  emitOpen(): void {
    this.openListener?.();
  }
}
