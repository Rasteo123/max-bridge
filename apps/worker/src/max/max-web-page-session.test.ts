import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";

import { MaxWebPageSession } from "./max-web-page-session.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MaxWebPageSession chat snapshots", () => {
  it("returns direct-chat presence and outgoing read acknowledgements", async () => {
    const session = listChatsSession([
      directChatPageModel({
        recipient: { online: true }
      })
    ]);

    await expect(session.listChats()).resolves.toEqual([
      expect.objectContaining({
        id: "chat-1",
        presence: "online",
        lastMessageDirection: "outgoing",
        deliveryStatus: "read"
      })
    ]);
  });

  it.each([
    {
      recipient: { $: { isOnline: false } },
      expected: "offline"
    },
    {
      recipient: {},
      expected: "unknown"
    },
    {
      recipient: { online: "true" },
      expected: "unknown"
    }
  ] as const)(
    "maps only trusted online booleans to $expected",
    async ({ recipient, expected }) => {
      const session = listChatsSession([
        directChatPageModel({ recipient })
      ]);

      await expect(session.listChats()).resolves.toEqual([
        expect.objectContaining({
          id: "chat-1",
          presence: expected
        })
      ]);
    }
  );

  it.each(["DELIVERED", "UNRECOGNIZED_ACK"])(
    "preserves raw history acknowledgement %s",
    async (acknowledgement) => {
      const session = listChatsSession([
        directChatPageModel({
          recipient: { online: true },
          messages: [{
            id: "history-message-1",
            senderId: "viewer-1",
            ack: acknowledgement,
            time: 1_721_843_200_000,
            text: "History"
          }]
        })
      ]);
      const internals = session as unknown as SessionInternals;

      await expect(internals.readMessages("chat-1")).resolves.toEqual([
        expect.objectContaining({
          id: "history-message-1",
          status: acknowledgement
        })
      ]);
    }
  );

  it("carries last-message attachments into the adapter snapshot", async () => {
    const session = listChatsSession([
      directChatPageModel({
        recipient: { online: true },
        lastMessage: {
          id: "message-1",
          senderId: "viewer-1",
          status: "READ",
          time: 1_721_843_200_000,
          attaches: [{ _type: "STICKER" }]
        }
      })
    ]);

    await expect(session.listChats()).resolves.toEqual([
      expect.objectContaining({
        id: "chat-1",
        preview: "Стикер"
      })
    ]);
  });
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

function listChatsSession(
  chats: readonly Record<string, unknown>[]
): MaxWebPageSession {
  const pageSession = {
    viewer: {
      id: "viewer-1",
      folders: {
        all: { chats }
      }
    }
  };
  const evaluate = vi.fn((
    callback: (argument: unknown) => unknown,
    argument: unknown
  ) => {
    const accessorKey = typeof argument === "string"
      ? argument
      : "maxbridge.max-session-accessor.v1";
    const accessorSymbol = Symbol.for(accessorKey);
    const documentDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "document"
    );
    const accessorDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      accessorSymbol
    );
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelectorAll: () => []
      }
    });
    Object.defineProperty(globalThis, accessorSymbol, {
      configurable: true,
      value: () => pageSession
    });
    try {
      return Promise.resolve(callback(argument));
    } finally {
      restoreGlobalProperty("document", documentDescriptor);
      restoreGlobalProperty(accessorSymbol, accessorDescriptor);
    }
  });
  const page = {
    on: vi.fn(),
    evaluate
  };
  return new MaxWebPageSession({
    page: page as unknown as Page,
    context: {} as BrowserContext
  });
}

function directChatPageModel(
  overrides: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return {
    id: "chat-1",
    longName: "Recipient",
    lastMessage: {
      id: "message-1",
      senderId: "viewer-1",
      status: "READ",
      time: 1_721_843_200_000,
      text: "Hello",
      attaches: []
    },
    newMessages: 0,
    muted: false,
    pinned: false,
    ...overrides
  };
}

function restoreGlobalProperty(
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, property);
  } else {
    Object.defineProperty(globalThis, property, descriptor);
  }
}
