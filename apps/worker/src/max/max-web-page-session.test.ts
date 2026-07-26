import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";

import { MaxWebPageSession } from "./max-web-page-session.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MaxWebPageSession history navigation", () => {
  it("accepts MAX textboxes with an empty contenteditable attribute", async () => {
    const waitFor = vi.fn(() => Promise.resolve());
    const locator = vi.fn(() => ({
      last: () => ({ waitFor })
    }));
    const page = {
      on: vi.fn(),
      waitForURL: vi.fn(() => Promise.resolve()),
      locator
    };
    const session = new MaxWebPageSession({
      page: page as unknown as Page,
      context: {} as BrowserContext
    });
    const internals = session as unknown as SessionInternals;

    await internals.waitForChatReady("target");

    expect(locator).toHaveBeenCalledWith(
      '[contenteditable]:not([contenteditable="false"])[role="textbox"], textarea'
    );
    expect(waitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: 7_500
    });
  });

  it("finishes alternate-chat recovery before returning to the target", async () => {
    vi.useFakeTimers();
    const page = {
      on: vi.fn(),
      url: vi.fn(() => "https://web.max.ru/target"),
      goto: vi.fn(() => Promise.resolve(null)),
      waitForTimeout: vi.fn((milliseconds: number) => {
        vi.advanceTimersByTime(milliseconds);
        return Promise.resolve();
      })
    };
    const session = new MaxWebPageSession({
      page: page as unknown as Page,
      context: {} as BrowserContext
    });
    const adapter = new FakeAdapter();
    const bindings = {
      moduleUrl: "https://web.max.ru/client.js",
      routerExport: "router"
    };
    const openChat = vi.fn<SessionInternals["openChat"]>(
      () => Promise.resolve()
    );
    const waitForChatReady = vi.fn<SessionInternals["waitForChatReady"]>()
      .mockRejectedValueOnce(new Error("route timeout"))
      .mockResolvedValue(undefined);
    const internals = session as unknown as SessionInternals;
    internals.ensureAdapter = vi.fn(() => Promise.resolve(adapter));
    internals.ensureBindings = vi.fn(() => Promise.resolve(bindings));
    internals.readMessages = vi.fn<SessionInternals["readMessages"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        message("one"),
        message("two")
    ]);
    internals.openChat = openChat;
    internals.waitForChatReady = waitForChatReady;
    session.listChats = vi.fn(() => Promise.resolve([
      chat("target"),
      chat("alternate")
    ]));

    await expect(session.history("target")).resolves.toHaveLength(2);

    expect(openChat.mock.calls.map(([, id]) => id)).toEqual([
      "alternate",
      "target"
    ]);
    expect(waitForChatReady.mock.calls.map(([id]) => id)).toEqual([
      "alternate",
      "alternate",
      "target"
    ]);
    expect(page.goto).toHaveBeenCalledWith(
      "https://web.max.ru/alternate",
      { waitUntil: "domcontentloaded" }
    );
    expect(internals.ensureBindings).toHaveBeenCalledTimes(3);
  });
});

type SessionInternals = {
  ensureAdapter: () => Promise<FakeAdapter>;
  ensureBindings: () => Promise<{
    moduleUrl: string;
    routerExport: string;
  }>;
  readMessages: (chatId: string) => Promise<readonly unknown[]>;
  openChat: (
    bindings: { moduleUrl: string; routerExport: string },
    chatId: string
  ) => Promise<void>;
  waitForChatReady: (chatId: string) => Promise<void>;
};

class FakeAdapter {
  openMessages: readonly ReturnType<typeof message>[] = [];

  openChat(): void {}

  replaceOpenHistory(input: Readonly<{
    messages: readonly ReturnType<typeof message>[];
  }>): void {
    this.openMessages = input.messages;
  }
}

function chat(id: string) {
  return {
    id,
    kind: "direct" as const,
    title: id,
    preview: "",
    timestamp: "2026-07-26T20:00:00.000Z",
    unreadCount: 0,
    muted: false
  };
}

function message(id: string) {
  return {
    id,
    chatId: "target",
    text: id,
    direction: "outgoing" as const,
    sentAt: "2026-07-26T20:00:00.000Z",
    kind: "text" as const
  };
}
