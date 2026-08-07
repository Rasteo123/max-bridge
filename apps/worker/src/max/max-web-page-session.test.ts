import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Locator, Page } from "playwright";

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

  it("ignores an unverified recipient.$.presence fallback", async () => {
    vi.setSystemTime(now);
    const rawSeen = Math.floor((now - 60_000) / 1_000);
    const session = listChatsSession([
      directChatPageModel({
        recipient: {
          $: {
            presence: {
              status: 0,
              isOnline: false,
              seen: now - 60_000,
              $: { seen: rawSeen }
            }
          }
        }
      })
    ]);

    const chats = await session.listChats();

    expect(chats[0]).toMatchObject({ presence: "unknown" });
    expect(chats[0]).not.toHaveProperty("lastSeenAt");
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

  // MAX puts no delivery status on a message; anything that looks like one
  // is stale and must not decide the tick.
  it("takes the tick from read markers, not from a status field", async () => {
    const session = listChatsSession([
      directChatPageModel({
        recipient: { online: true },
        participants: {
          "viewer-1": 1_721_843_300_000,
          "other-1": 1_721_843_100_000
        },
        lastMessage: {
          id: "message-1",
          senderId: "viewer-1",
          ack: "READ",
          time: 1_721_843_200_000,
          text: "Priority",
          $: { status: "READ" }
        }
      })
    ]);

    await expect(session.listChats()).resolves.toEqual([
      expect.objectContaining({
        id: "chat-1",
        deliveryStatus: "delivered"
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

  it("projects a bounded rich forwarded source and caption links", async () => {
    const session = listChatsSession([
      directChatPageModel({
        messages: [{
          id: "history-forwarded-1",
          senderId: "other-user",
          status: "DELIVERED",
          time: 1_721_843_200_000,
          caption: "Доброе утро 🌻 открыть",
          textLinks: [{
            offset: 14,
            length: 7,
            url: "https://max.ru/channel/synthetic"
          }],
          forwarded: {
            caption: "Доброе утро 🌻 открыть",
            source: {
              id: -68_429_202_642_371,
              title: "ВСЕ ОТКРЫТКИ ТУТ",
              type: "CHANNEL"
            }
          },
          attaches: [{
            _type: "PHOTO",
            url: "https://i.oneme.ru/history-forwarded"
          }]
        }]
      })
    ]);
    const internals = session as unknown as SessionInternals;

    await expect(internals.readMessages("chat-1")).resolves.toEqual([
      expect.objectContaining({
        id: "history-forwarded-1",
        text: "Доброе утро 🌻 открыть",
        forwardedFrom: "ВСЕ ОТКРЫТКИ ТУТ",
        forwardedSource: {
          title: "ВСЕ ОТКРЫТКИ ТУТ",
          chatId: "-68429202642371",
          kind: "channel"
        },
        textLinks: [{
          offset: 14,
          length: 7,
          url: "https://max.ru/channel/synthetic"
        }]
      })
    ]);
  });

  it("does not project an incomplete forwarded source as navigable", async () => {
    const session = listChatsSession([
      directChatPageModel({
        messages: [{
          id: "history-forwarded-incomplete",
          senderId: "other-user",
          time: 1_721_843_200_000,
          text: "Переслано",
          forwarded: {
            source: {
              id: "source-without-kind",
              title: "Неизвестный источник"
            }
          }
        }]
      })
    ]);
    const internals = session as unknown as SessionInternals;

    const messages = await internals.readMessages("chat-1") as Array<
      Record<string, unknown>
    >;
    expect(messages[0]).not.toHaveProperty("forwardedSource");
    expect(messages[0]).toMatchObject({
      forwardedFrom: "Неизвестный источник"
    });
  });
});

describe("MaxWebPageSession native forwarding", () => {
  it("selects the exact requested destinations and confirms once", async () => {
    const fixture = forwardingSession();

    await expect(fixture.session.forwardMessage(
      "source-chat",
      "source-message",
      ["destination-1", "destination-2"]
    )).resolves.toMatchObject({ state: "confirmed" });

    expect(fixture.openMessageMenu).toHaveBeenCalledWith(
      "source-chat",
      "source-message"
    );
    expect(fixture.clickMenuItem).toHaveBeenCalledWith(
      fixture.menu,
      "Переслать"
    );
    expect(fixture.search.fill.mock.calls.map(([value]) => value)).toEqual([
      "Получатель 1",
      "",
      "Получатель 2",
      ""
    ]);
    expect(fixture.rows.map((row) => row.click)).toEqual([
      expect.any(Function),
      expect.any(Function)
    ]);
    expect(fixture.rows[0]?.click).toHaveBeenCalledTimes(1);
    expect(fixture.rows[1]?.click).toHaveBeenCalledTimes(1);
    expect(fixture.send.click).toHaveBeenCalledTimes(1);
  });

  it("returns ambiguous after one click when MAX does not close the picker", async () => {
    const fixture = forwardingSession({ confirmationVisible: true });

    await expect(fixture.session.forwardMessage(
      "source-chat",
      "source-message",
      ["destination-1"]
    )).resolves.toMatchObject({ state: "ambiguous" });

    expect(fixture.send.click).toHaveBeenCalledTimes(1);
  });
});

describe("MaxWebPageSession native attachment modes", () => {
  it("finds the composer controls by icon, not by their Russian names", async () => {
    const harness = attachmentSession();

    await harness.internals.sendAttachmentThroughUi(
      "/run/maxbridge/media/synthetic/file.bin",
      "media"
    );

    const selectors = harness.locatorSelectors.join(" ");
    expect(selectors).toContain("#icon_attachment");
    expect(selectors).toContain("#icon_image");
    expect(selectors).toContain("#icon_send");
    expect(selectors).not.toContain("Загрузить");
  });

  it("waits for the composer instead of demanding it be there already", async () => {
    const harness = attachmentSession();

    await harness.internals.sendAttachmentThroughUi(
      "/run/maxbridge/media/synthetic/file.bin",
      "file"
    );

    expect(harness.trigger.waitFor).toHaveBeenCalledOnce();
    expect(JSON.stringify(harness.trigger.waitFor.mock.calls))
      .toContain('"state":"visible"');
    expect(harness.trigger.click).toHaveBeenCalledOnce();
  });

  it.each([
    ["media", "Фото или видео"],
    ["file", "Файл"]
  ] as const)(
    "uses the dialog-scoped input for %s",
    async (kind, expectedMode) => {
      const fixture = attachmentSession();

      await expect(fixture.internals.sendAttachmentThroughUi(
        "/run/maxbridge/media/synthetic/file.bin",
        kind
      )).resolves.toMatchObject({
        state: "confirmed",
        messageId: "uploaded-message"
      });

      expect(fixture.trigger.click).toHaveBeenCalledTimes(1);
      expect(fixture.modeNames).toEqual([expectedMode]);
      expect(fixture.scopedInput.setInputFiles).toHaveBeenCalledWith(
        "/run/maxbridge/media/synthetic/file.bin"
      );
      expect(fixture.unrelatedInputs.every((input) =>
        input.setInputFiles.mock.calls.length === 0
      )).toBe(true);
      expect(fixture.send.click).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    "open_menu",
    "select_mode",
    "set_file",
    "wait_for_preview",
    "send"
  ] as const)("clears pending confirmation after %s failure", async (stage) => {
    const fixture = attachmentSession({ failStage: stage });

    await expect(fixture.internals.sendAttachmentThroughUi(
      "/run/maxbridge/media/synthetic/file.bin",
      "media"
    )).rejects.toThrow("MAX attachment send failed before confirmation");

    expect(fixture.internals.pendingSend).toBeUndefined();
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

    await expect(internals.openChatForActions("target")).resolves.toBe(true);

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
  openChatForActions: (chatId: string) => Promise<boolean>;
  openChat: (
    bindings: { moduleUrl: string; routerExport: string },
    chatId: string
  ) => Promise<void>;
  waitForChatReady: (chatId: string) => Promise<void>;
  openMessageMenu: (
    chatId: string,
    messageId: string
  ) => Promise<Locator>;
  clickMenuItem: (dialog: Locator, label: string) => Promise<void>;
  sendAttachmentThroughUi: (
    filePath: string,
    kind: "media" | "file"
  ) => Promise<Readonly<{
    state: "confirmed" | "ambiguous";
    operationId: string;
    messageId?: string;
  }>>;
  resolvePendingSend: (messageId: string | undefined) => void;
  pendingSend?: unknown;
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

function forwardingSession(
  options: Readonly<{ confirmationVisible?: boolean }> = {}
) {
  const search = {
    waitFor: vi.fn(() => Promise.resolve()),
    fill: vi.fn((value: string) => {
      void value;
      return Promise.resolve();
    })
  };
  const rows: Array<{
    count: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
  }> = [];
  const send = {
    waitFor: vi.fn(() => Promise.resolve()),
    isEnabled: vi.fn(() => Promise.resolve(true)),
    click: vi.fn(() => Promise.resolve())
  };
  const picker = {
    waitFor: vi.fn((input: Readonly<{ state: string }>) => {
      if (input.state === "hidden" && options.confirmationVisible === true) {
        return Promise.reject(new Error("still visible"));
      }
      return Promise.resolve();
    }),
    getByPlaceholder: vi.fn(() => search),
    getByRole: vi.fn(() => send),
    locator: vi.fn(() => ({
      filter: vi.fn(() => {
        const row = {
          count: vi.fn(() => Promise.resolve(1)),
          click: vi.fn(() => Promise.resolve())
        };
        rows.push(row);
        return row;
      })
    })),
    press: vi.fn(() => Promise.resolve())
  };
  const menu = {} as Locator;
  const page = {
    on: vi.fn(),
    getByRole: vi.fn(() => ({
      last: () => picker
    }))
  };
  const session = new MaxWebPageSession({
    page: page as unknown as Page,
    context: {} as BrowserContext
  });
  session.listChats = vi.fn(() => Promise.resolve([
    { ...chat("destination-1"), title: "Получатель 1" },
    { ...chat("destination-2"), title: "Получатель 2" }
  ]));
  const internals = session as unknown as SessionInternals;
  internals.openChatForActions = vi.fn(() => Promise.resolve(true));
  const openMessageMenu = vi.fn(() => Promise.resolve(menu));
  const clickMenuItem = vi.fn(() => Promise.resolve());
  internals.openMessageMenu = openMessageMenu;
  internals.clickMenuItem = clickMenuItem;
  return {
    session,
    menu,
    search,
    rows,
    send,
    openMessageMenu,
    clickMenuItem
  };
}

function attachmentSession(options: Readonly<{
  failStage?:
    | "open_menu"
    | "select_mode"
    | "set_file"
    | "wait_for_preview"
    | "send";
}> = {}) {
  const input = () => ({
    waitFor: vi.fn(() => Promise.resolve()),
    setInputFiles: vi.fn(() => Promise.resolve())
  });
  const unrelatedInputs = [input(), input()];
  const scopedInput = input();
  if (options.failStage === "set_file") {
    scopedInput.setInputFiles.mockRejectedValue(new Error("set file"));
  }
  const scopedInputs = {
    count: vi.fn(() => Promise.resolve(1)),
    last: vi.fn(() => scopedInput)
  };
  const dialog = {
    locator: vi.fn(() => scopedInputs)
  };
  const dialogs = {
    count: vi.fn(() => Promise.resolve(1)),
    last: vi.fn(() => dialog)
  };
  const trigger = {
    first: vi.fn(),
    waitFor: vi.fn(() => options.failStage === "open_menu"
      ? Promise.reject(new Error("no composer yet"))
      : Promise.resolve()),
    click: vi.fn(() => Promise.resolve())
  };
  trigger.first.mockImplementation(() => trigger);
  const modeNames: string[] = [];
  const modeItem = {
    first: vi.fn(),
    waitFor: vi.fn(() => Promise.resolve()),
    click: vi.fn(() => options.failStage === "select_mode"
      ? Promise.reject(new Error("select mode"))
      : Promise.resolve())
  };
  modeItem.first.mockImplementation(() => modeItem);
  const send = {
    first: vi.fn(),
    waitFor: vi.fn(() => Promise.resolve()),
    click: vi.fn(() => Promise.resolve())
  };
  send.first.mockImplementation(() => send);
  const empty = {
    count: vi.fn(() => Promise.resolve(0)),
    first: vi.fn()
  };
  const allInputs = {
    count: vi.fn(() => Promise.resolve(unrelatedInputs.length)),
    nth: vi.fn((index: number) => unrelatedInputs[index]),
    first: vi.fn(() => unrelatedInputs[0]),
    last: vi.fn(() => unrelatedInputs.at(-1))
  };
  const locatorSelectors: string[] = [];
  const page = {
    on: vi.fn(),
    locator: vi.fn((selector: string) => {
      locatorSelectors.push(selector);
      if (selector.includes("#icon_attachment")) {
        return trigger;
      }
      if (selector.includes("#icon_image") || selector.includes("#icon_file")) {
        modeNames.push(
          selector.includes("#icon_image") ? "Фото или видео" : "Файл"
        );
        return modeItem;
      }
      if (selector.includes("#icon_send")) {
        return send;
      }
      if (selector === 'input[type="file"]') {
        return allInputs;
      }
      if (selector.includes('input[type="file"]')) {
        return empty;
      }
      return empty;
    }),
    getByRole: vi.fn((
      role: string,
      roleOptions?: Readonly<{ name?: string | RegExp }>
    ) => {
      if (role === "dialog") {
        return dialogs;
      }
      if (role === "menuitem") {
        return modeItem;
      }
      if (role === "button" && roleOptions?.name instanceof RegExp) {
        return trigger;
      }
      return send;
    }),
    waitForFunction: vi.fn(() =>
      options.failStage === "wait_for_preview"
        ? Promise.reject(new Error("preview"))
        : Promise.resolve()
    )
  };
  const session = new MaxWebPageSession({
    page: page as unknown as Page,
    context: {} as BrowserContext
  });
  const internals = session as unknown as SessionInternals;
  send.click.mockImplementation(() => {
    if (options.failStage === "send") {
      return Promise.reject(new Error("send"));
    }
    internals.resolvePendingSend("uploaded-message");
    return Promise.resolve();
  });
  return {
    internals,
    trigger,
    locatorSelectors,
    modeNames,
    scopedInput,
    unrelatedInputs,
    send
  };
}

function directChatPageModel(
  overrides: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return {
    id: "chat-1",
    longName: "Recipient",
    // MAX records how far each participant has read; the viewer's own mark is
    // ignored, so only the recipient's decides the tick.
    participants: {
      "viewer-1": 1_721_843_300_000,
      "other-1": 1_721_843_250_000
    },
    lastMessage: {
      id: "message-1",
      senderId: "viewer-1",
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
