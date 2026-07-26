// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedSocket } from "./socket.js";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe("AuthenticatedSocket", () => {
  it("reauthenticates from current Telegram initData without browser tokens", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const authenticate = vi.fn().mockResolvedValue(undefined);
    const createSocket = vi.fn(() => socket as unknown as WebSocket);
    const bridge = new AuthenticatedSocket({
      initData: () => "signed-live-init-data",
      authenticate,
      createSocket,
      reconnectDelayMs: 10
    });

    bridge.start();
    socket.emitClose(1_008);
    await vi.runAllTimersAsync();

    expect(authenticate).toHaveBeenCalledWith("signed-live-init-data");
    expect(createSocket).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/ws$/u)
    );
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    bridge.stop();
  });
});

class FakeSocket {
  private closeListener: ((event: CloseEvent) => void) | undefined;

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    if (type === "close" && typeof listener === "function") {
      this.closeListener = listener;
    }
  }

  close(): void {}

  emitClose(code: number): void {
    this.closeListener?.({ code } as CloseEvent);
  }
}
