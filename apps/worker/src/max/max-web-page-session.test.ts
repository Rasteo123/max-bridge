import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";

import { MaxWebPageSession } from "./max-web-page-session.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MaxWebPageSession chat snapshots", () => {
  const now = Date.parse("2026-07-27T10:00:00.000Z");

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

  it.each([
    [0, "offline"],
    [1, "online"],
    [2, "recently"],
    [3, "long_ago"]
  ] as const)(
    "projects nested MAX presence status %s as %s",
    async (status, expected) => {
      const session = listChatsSession([
        directChatPageModel({
          recipient: {
            presence: {
              status,
              isOnline: status === 1
            },
            online: status !== 0
          }
        })
      ]);

      await expect(session.listChats()).resolves.toEqual([
        expect.objectContaining({
          id: "chat-1",
          presence: expected
        })
      ]);
    }
  );

  it("projects trusted last-seen milliseconds without enumerating presence", async () => {
    vi.setSystemTime(now);
    const lastSeenAt = now - 5 * 60_000;
    const presence = new Proxy({
      status: 0,
      isOnline: false,
      seen: lastSeenAt,
      $: { seen: Math.floor(lastSeenAt / 1_000) }
    }, {
      ownKeys: () => {
        throw new Error("presence keys must not be enumerated");
      }
    });
    const session = listChatsSession([
      directChatPageModel({
        recipient: {
          presence,
          online: true
        }
      })
    ]);

    await expect(session.listChats()).resolves.toEqual([
      expect.objectContaining({
        id: "chat-1",
        presence: "offline",
        lastSeenAt
      })
    ]);
  });

  it("projects raw last-seen seconds only from presence.$.seen", async () => {
    vi.setSystemTime(now);
    const rawSeen = Math.floor((now - 2 * 60 * 60_000) / 1_000);
    const session = listChatsSession([
      directChatPageModel({
        recipient: {
          presence: {
            status: 0,
            $: { seen: rawSeen }
          }
        }
      })
    ]);

    await expect(session.listChats()).resolves.toEqual([
      expect.objectContaining({
        id: "chat-1",
        presence: "offline",
        lastSeenAt: rawSeen * 1_000
      })
    ]);
  });

  it("does not project activity fields as last-seen time", async () => {
    vi.setSystemTime(now);
    const session = listChatsSession([
      directChatPageModel({
        recipient: {
          presence: { status: 0 },
          lastSeenAt: now - 60_000
        },
        lastSeenAt: now - 60_000,
        lastActivity: now - 60_000,
        openChat: true,
        lastMessage: {
          id: "message-activity",
          senderId: "viewer-2",
          status: "READ",
          time: now - 60_000,
          text: "Активность",
          seen: now - 60_000
        }
      })
    ]);

    const chats = await session.listChats();

    expect(chats[0]).not.toHaveProperty("lastSeenAt");
  });

  it.each([
    ["string", { seen: String(now - 60_000) }],
    ["boolean", { seen: true }],
    ["ambiguous direct seconds", { seen: 1_785_146_400 }],
    ["ambiguous raw milliseconds", { $: { seen: now - 60_000 } }]
  ] as const)(
    "rejects %s last-seen units in the real page projection",
    async (_label, seenFields) => {
      vi.setSystemTime(now);
      const session = listChatsSession([
        directChatPageModel({
          recipient: {
            presence: {
              status: 0,
              ...seenFields
            }
          }
        })
      ]);

      const chats = await session.listChats();

      expect(chats[0]).not.toHaveProperty("lastSeenAt");
    }
  );

  it.each([
    ["status", { status: "STATUS_VALUE" }, "STATUS_VALUE"],
    [
      "deliveryStatus",
      { deliveryStatus: "DELIVERY_STATUS_VALUE" },
      "DELIVERY_STATUS_VALUE"
    ],
    ["ack", { ack: "ACK_VALUE" }, "ACK_VALUE"],
    ["$.status", { $: { status: "RAW_STATUS_VALUE" } }, "RAW_STATUS_VALUE"],
    [
      "$.deliveryStatus",
      { $: { deliveryStatus: "RAW_DELIVERY_STATUS_VALUE" } },
      "RAW_DELIVERY_STATUS_VALUE"
    ],
    ["$.ack", { $: { ack: "RAW_ACK_VALUE" } }, "RAW_ACK_VALUE"]
  ] as const)(
    "preserves history acknowledgement from %s",
    async (_source, statusFields, expectedStatus) => {
      const session = listChatsSession([
        directChatPageModel({
          recipient: { online: true },
          messages: [{
            id: "history-message-1",
            senderId: "viewer-1",
            time: 1_721_843_200_000,
            text: "History",
            ...statusFields
          }]
        })
      ]);
      const internals = session as unknown as SessionInternals;

      await expect(internals.readMessages("chat-1")).resolves.toEqual([
        expect.objectContaining({
          id: "history-message-1",
          status: expectedStatus
        })
      ]);
    }
  );

  it("prefers every top-level history status alias over raw aliases", async () => {
    const session = listChatsSession([
      directChatPageModel({
        recipient: { online: true },
        messages: [{
          id: "history-message-1",
          senderId: "viewer-1",
          ack: "SENT",
          time: 1_721_843_200_000,
          text: "History",
          $: { status: "READ" }
        }]
      })
    ]);
    const internals = session as unknown as SessionInternals;

    await expect(internals.readMessages("chat-1")).resolves.toEqual([
      expect.objectContaining({
        id: "history-message-1",
        status: "SENT"
      })
    ]);
  });

  it("reads last-message fields from the raw $ record", async () => {
    const session = listChatsSession([
      directChatPageModel({
        recipient: { online: true },
        lastMessage: {
          $: {
            id: "message-raw",
            sender: "viewer-1",
            deliveryStatus: "READ",
            time: 1_721_843_200_000,
            text: { plain: "Wrapped text" },
            attaches: []
          }
        }
      })
    ]);

    await expect(session.listChats()).resolves.toEqual([
      expect.objectContaining({
        id: "chat-1",
        lastMessageDirection: "outgoing",
        deliveryStatus: "read",
        timestamp: "2024-07-24T17:46:40.000Z",
        preview: "Wrapped text"
      })
    ]);
  });

  it("prefers every top-level last-message status alias over raw aliases", async () => {
    const session = listChatsSession([
      directChatPageModel({
        recipient: { online: true },
        lastMessage: {
          id: "message-1",
          senderId: "viewer-1",
          ack: "SENT",
          time: 1_721_843_200_000,
          text: "Priority",
          $: { status: "READ" }
        }
      })
    ]);

    await expect(session.listChats()).resolves.toEqual([
      expect.objectContaining({
        id: "chat-1",
        deliveryStatus: "sent"
      })
    ]);
  });

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

  it("projects raw wrapped attachments into bounded JSON-safe metadata", async () => {
    const cyclicAttachment: Record<string, unknown> = {
      _type: "STICKER",
      name: "x".repeat(1_000),
      unsupported: () => "not cloneable"
    };
    cyclicAttachment["self"] = cyclicAttachment;
    const proxiedAttachment = new Proxy(cyclicAttachment, {
      ownKeys: () => {
        throw new Error("attachment keys must not be enumerated");
      }
    });
    const session = listChatsSession([
      directChatPageModel({
        recipient: { online: true },
        lastMessage: {
          $: {
            id: "message-raw",
            senderId: "viewer-1",
            status: "READ",
            time: 1_721_843_200_000,
            attaches: [{ $: proxiedAttachment }]
          }
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

  it("projects history attachments without enumerating raw page objects", async () => {
    const cyclicAttachment: Record<string, unknown> = {
      _type: "PHOTO",
      url: "https://i.oneme.ru/history-photo",
      width: 640,
      height: 480,
      name: "x".repeat(1_000),
      unsupported: () => "not cloneable"
    };
    cyclicAttachment["self"] = cyclicAttachment;
    const proxiedAttachment = new Proxy(cyclicAttachment, {
      ownKeys: () => {
        throw new Error("attachment keys must not be enumerated");
      }
    });
    const session = listChatsSession([
      directChatPageModel({
        recipient: { online: true },
        messages: [{
          id: "history-message-1",
          senderId: "viewer-1",
          status: "DELIVERED",
          time: 1_721_843_200_000,
          text: "History",
          attaches: [{ $: proxiedAttachment }]
        }]
      })
    ]);
    const internals = session as unknown as SessionInternals;

    await expect(internals.readMessages("chat-1")).resolves.toEqual([
      expect.objectContaining({
        id: "history-message-1",
        attaches: [
          expect.objectContaining({
            _type: "PHOTO",
            url: "https://i.oneme.ru/history-photo",
            width: 640,
            height: 480,
            name: "x".repeat(255)
          })
        ]
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
      return Promise.resolve(structuredClone(callback(argument)));
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
