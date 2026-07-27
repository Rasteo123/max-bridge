import { readFile } from "node:fs/promises";

import {
  parseChatSummary,
  parseMessage
} from "@maxbridge/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adaptChatList } from "./chat-list-adapter.js";
import { MaxCompatibilityError } from "./errors.js";
import { adaptHistoryPage } from "./history-adapter.js";
import { LiveEventAdapter } from "./live-event-adapter.js";
import { RuntimeMediaAdapter } from "./media-adapter.js";

type DomainFixture = Readonly<{
  viewerId: string;
  chatList: unknown;
  history: unknown;
  liveIncoming: unknown;
  liveDeleted: unknown;
  unknown: unknown;
}>;

let fixture: DomainFixture;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  fixture = await loadFixture();
});

describe("MAX chat list adapter", () => {
  const now = Date.parse("2026-07-27T10:00:00.000Z");

  it("adapts direct and group summaries with preview, time and unread count", () => {
    const media = new RuntimeMediaAdapter();

    const page = adaptChatList(fixture.chatList, { media });

    expect(page.chats).toHaveLength(2);
    expect(page.chats.map((chat) => chat.kind).sort())
      .toEqual(["direct", "group"]);
    expect(page.chats.find((chat) => chat.kind === "direct")).toMatchObject({
      title: "Синтетический контакт",
      preview: "Синтетический привет",
      unreadCount: 2,
      muted: false
    });
    expect(page.chats.find((chat) => chat.kind === "group")).toMatchObject({
      title: "Синтетическая группа",
      preview: "Изображение",
      muted: true
    });
    for (const chat of page.chats) {
      expect(() => parseChatSummary(chat)).not.toThrow();
    }
    expect(page.nextCursor).toBe("1000");
    expect(page.hasMore).toBe(true);
  });

  it("normalizes direct-chat presence and outgoing read receipts", () => {
    const page = adaptChatList({
      chats: [{
        id: "presence-chat",
        type: "DIALOG",
        title: "Ольга",
        viewerId: fixture.viewerId,
        recipient: {
          online: true
        },
        lastMessage: {
          id: "presence-message",
          sender: fixture.viewerId,
          time: "2026-07-27T10:00:00.000Z",
          text: "До встречи",
          status: "READ"
        }
      }]
    }, { media: new RuntimeMediaAdapter() });

    expect(page.chats[0]).toMatchObject({
      presence: "online",
      lastMessageDirection: "outgoing",
      deliveryStatus: "read"
    });
  });

  it.each([
    [0, "offline"],
    [1, "online"],
    [2, "recently"],
    [3, "long_ago"]
  ] as const)(
    "normalizes trusted nested presence status %s to %s",
    (status, expected) => {
      const page = adaptChatList({
        chats: [{
          id: `presence-status-${String(status)}`,
          type: "DIALOG",
          title: "Ольга",
          recipient: {
            presence: {
              status,
              isOnline: status === 1
            },
            online: status !== 0
          }
        }]
      }, { media: new RuntimeMediaAdapter() });

      expect(page.chats[0]?.presence).toBe(expected);
    }
  );

  it("keeps a trusted millisecond last-seen time for an offline direct chat", () => {
    vi.setSystemTime(now);
    const lastSeenAt = now - 5 * 60_000;
    const page = adaptChatList({
      chats: [{
        id: "presence-last-seen-ms",
        type: "DIALOG",
        title: "Ольга",
        recipient: {
          presence: {
            status: 0,
            seen: lastSeenAt
          }
        }
      }]
    }, { media: new RuntimeMediaAdapter() });

    expect(page.chats[0]).toMatchObject({
      presence: "offline",
      lastSeenAt
    });
  });

  it("converts seconds only from the verified raw presence field", () => {
    vi.setSystemTime(now);
    const rawSeen = Math.floor((now - 2 * 60 * 60_000) / 1_000);
    const page = adaptChatList({
      chats: [{
        id: "presence-last-seen-raw",
        type: "DIALOG",
        title: "Ольга",
        recipient: {
          presence: {
            status: 0,
            $: { seen: rawSeen }
          }
        }
      }]
    }, { media: new RuntimeMediaAdapter() });

    expect(page.chats[0]).toMatchObject({
      presence: "offline",
      lastSeenAt: rawSeen * 1_000
    });
  });

  it.each([
    [
      "online",
      "DIALOG",
      { status: 1, seen: now - 60_000 }
    ],
    [
      "recently",
      "DIALOG",
      { status: 2, seen: now - 60_000 }
    ],
    [
      "long ago",
      "DIALOG",
      { status: 3, seen: now - 60_000 }
    ],
    [
      "unknown",
      "DIALOG",
      { seen: now - 60_000 }
    ],
    [
      "group",
      "CHAT",
      { status: 0, seen: now - 60_000 }
    ],
    [
      "channel",
      "CHANNEL",
      { status: 0, seen: now - 60_000 }
    ]
  ] as const)(
    "omits lastSeenAt for %s presence",
    (_label, type, presence) => {
      vi.setSystemTime(now);
      const page = adaptChatList({
        chats: [{
          id: `presence-last-seen-${_label}`,
          type,
          title: "Граница",
          recipient: { presence }
        }]
      }, { media: new RuntimeMediaAdapter() });

      expect(page.chats[0]).not.toHaveProperty("lastSeenAt");
    }
  );

  it.each([
    ["seconds in the millisecond field", { seen: 1_785_146_400 }],
    ["a string millisecond value", { seen: String(now - 60_000) }],
    ["a boolean value", { seen: true }],
    ["a negative raw value", { $: { seen: -1 } }],
    ["an ambiguous millisecond raw value", { $: { seen: now - 60_000 } }],
    ["an implausibly old value", { seen: now - 11 * 366 * 24 * 60 * 60_000 }],
    ["a future-skewed value", { seen: now + 5 * 60_000 + 1 }]
  ] as const)(
    "rejects last-seen input from %s",
    (_label, seenFields) => {
      vi.setSystemTime(now);
      const page = adaptChatList({
        chats: [{
          id: `presence-invalid-${_label}`,
          type: "DIALOG",
          title: "Граница",
          recipient: {
            presence: {
              status: 0,
              ...seenFields
            }
          }
        }]
      }, { media: new RuntimeMediaAdapter() });

      expect(page.chats[0]).not.toHaveProperty("lastSeenAt");
    }
  );

  it("does not infer lastSeenAt from chat or message activity", () => {
    vi.setSystemTime(now);
    const page = adaptChatList({
      chats: [{
        id: "presence-no-inference",
        type: "DIALOG",
        title: "Граница",
        recipient: {
          presence: { status: 0 },
          lastSeenAt: now - 60_000
        },
        lastSeenAt: now - 60_000,
        lastActivity: now - 60_000,
        openChat: true,
        lastMessage: {
          id: "message-activity",
          senderId: "someone",
          time: now - 60_000,
          text: "Активность"
        }
      }]
    }, { media: new RuntimeMediaAdapter() });

    expect(page.chats[0]).toMatchObject({ presence: "offline" });
    expect(page.chats[0]).not.toHaveProperty("lastSeenAt");
  });

  it.each([
    ["false", { recipient: { online: false } }, "offline"],
    ["absent", {}, "unknown"],
    ["non-boolean", { recipient: { online: "true" } }, "unknown"],
    [
      "activity metadata",
      {
        recipient: {
          lastSeen: "2026-07-27T10:00:00.000Z",
          lastSeenAt: 1_785_146_400_000,
          timestamp: 1_785_146_400_000,
          open: true,
          isOpen: true
        },
        lastSeen: "2026-07-27T10:00:00.000Z",
        lastActivity: 1_785_146_400_000,
        openChat: true
      },
      "unknown"
    ]
  ] as const)(
    "normalizes direct presence with %s input to %s",
    (_label, fields, expected) => {
      const page = adaptChatList({
        chats: [{
          id: `presence-${_label}`,
          type: "DIALOG",
          title: "Граница присутствия",
          ...fields
        }]
      }, { media: new RuntimeMediaAdapter() });

      expect(page.chats[0]?.presence).toBe(expected);
    }
  );

  it.each([
    [
      "recipient",
      {
        recipient: {
          online: false,
          view: { online: true }
        },
        view: { online: true },
        online: true
      }
    ],
    [
      "recipient view",
      {
        recipient: {
          view: { online: false }
        },
        view: { online: true },
        online: true
      }
    ],
    [
      "chat view",
      {
        recipient: {},
        view: { online: false },
        online: true
      }
    ]
  ] as const)("gives %s presence precedence", (_source, fields) => {
    const page = adaptChatList({
      chats: [{
        id: `presence-precedence-${_source}`,
        type: "DIALOG",
        title: "Приоритет присутствия",
        ...fields
      }]
    }, { media: new RuntimeMediaAdapter() });

    expect(page.chats[0]?.presence).toBe("offline");
  });

  it("omits presence from group chats even with an online flag", () => {
    const page = adaptChatList({
      chats: [{
        id: "presence-group",
        type: "CHAT",
        title: "Группа",
        recipient: { online: true },
        view: { online: true },
        online: true
      }]
    }, { media: new RuntimeMediaAdapter() });

    expect(page.chats[0]?.kind).toBe("group");
    expect(page.chats[0]).not.toHaveProperty("presence");
  });
});

describe("MAX history and media adapters", () => {
  it("exposes only validated MAX CDN media URLs with route-safe handles", () => {
    const media = new RuntimeMediaAdapter();
    const safe = media.adaptAttachment({
      _type: "PHOTO",
      url: "https://i.oneme.ru/i?r=signed&expires=1785192900426"
    }, {
      chatId: "1001",
      messageId: "3002",
      index: 0
    });
    const unsafe = media.adaptAttachment({
      _type: "PHOTO",
      url: "https://example.com/private.png"
    }, {
      chatId: "1001",
      messageId: "3003",
      index: 0
    });

    expect(safe.metadata.handle).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(safe.metadata.sourceUrl).toBe(
      "https://i.oneme.ru/i?r=signed&expires=1785192900426"
    );
    expect(unsafe.metadata.sourceUrl).toBeUndefined();
  });

  it("renders MAX stickers as images instead of generic files", () => {
    const adapted = new RuntimeMediaAdapter().adaptAttachment({
      _type: "STICKER",
      url: "https://i.oneme.ru/i?r=sticker"
    }, {
      chatId: "1001",
      messageId: "sticker-message",
      index: 0
    });

    expect(adapted.kind).toBe("image");
    expect(adapted.metadata.mimeType).toBe("image/jpeg");
  });

  it("adapts text, image, video, voice, file and system messages", () => {
    const media = new RuntimeMediaAdapter();

    const page = adaptHistoryPage(fixture.history, {
      chatId: "1001",
      viewerId: fixture.viewerId,
      media
    });

    expect(page.messages.map((message) => message.kind)).toEqual([
      "text",
      "image",
      "video",
      "voice",
      "file",
      "system",
      "text",
      "text"
    ]);
    expect(page.messages[1]).toMatchObject({
      direction: "outgoing",
      text: "Подпись к фото",
      media: {
        width: 1280,
        height: 720
      }
    });
    expect(page.messages[4]).toMatchObject({
      media: {
        fileName: "test.pdf",
        mimeType: "application/pdf",
        size: 12345
      }
    });
    expect(page.messages[6]).toMatchObject({ edited: true });
    expect(page.messages[7]).toMatchObject({
      deleted: true,
      text: "Сообщение удалено"
    });
    for (const message of page.messages) {
      expect(() => parseMessage(message)).not.toThrow();
    }
    expect(page.nextCursor).toBe("3001");
    expect(page.hasMore).toBe(true);
  });

  it.each([
    ["PENDING", "pending"],
    ["SENT", "sent"],
    ["ACKNOWLEDGED", "delivered"],
    ["DELIVERED", "delivered"],
    ["SEEN", "read"],
    ["READ", "read"],
    ["FAILED", "failed"],
    ["FAILURE", "failed"],
    ["ERROR", "failed"],
    ["REJECTED", "failed"],
    ["CANCELED", "failed"],
    ["CANCELLED", "failed"],
    ["UNKNOWN", "sent"]
  ] as const)("normalizes %s delivery status to %s", (status, expected) => {
    const page = adaptHistoryPage({
      messages: [{
        id: `status-${status}`,
        sender: fixture.viewerId,
        time: "2026-07-27T10:00:00.000Z",
        text: "Статус",
        status
      }]
    }, {
      chatId: "1001",
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });

    expect(page.messages[0]?.status).toBe(expected);
  });

  it("preserves validated reactions and reply metadata", () => {
    const page = adaptHistoryPage({
      messages: [{
        id: "reaction-message",
        senderId: fixture.viewerId,
        time: "2026-07-27T00:00:00.000Z",
        text: "Ответ",
        replyToId: "previous-message",
        forwardedFrom: "Исходный канал",
        edited: true,
        reactions: [
          {
            key: "like",
            emoji: "👍",
            count: 2,
            selectedByMe: true
          },
          {
            key: "not-supported",
            emoji: "?",
            count: 1,
            selectedByMe: false
          }
        ]
      }]
    }, {
      chatId: "1001",
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });

    expect(page.messages[0]).toMatchObject({
      replyToId: "previous-message",
      forwardedFrom: "Исходный канал",
      edited: true,
      reactions: [{
        key: "like",
        emoji: "👍",
        count: 2,
        selectedByMe: true
      }]
    });
    expect(() => parseMessage(page.messages[0])).not.toThrow();
  });

  it("keeps media descriptors only in bounded memory and zeros previews", () => {
    const media = new RuntimeMediaAdapter({ maxEntries: 10 });
    const page = adaptHistoryPage(fixture.history, {
      chatId: "1001",
      viewerId: fixture.viewerId,
      media
    });
    const image = page.messages.find((message) => message.kind === "image");
    if (image === undefined || !("media" in image)) {
      throw new Error("Synthetic image is missing");
    }
    const descriptor = media.resolve(image.media.handle);
    expect(descriptor?.previewData).toEqual(Uint8Array.from([1, 2, 3]));
    const preview = descriptor?.previewData;
    expect(media.size).toBeLessThanOrEqual(10);

    media.clear();

    expect(media.size).toBe(0);
    expect(preview?.every((byte) => byte === 0)).toBe(true);
  });
});

describe("MAX live event adapter", () => {
  it("suppresses duplicates and tracks a reconnect cursor", () => {
    const adapter = new LiveEventAdapter({
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });

    const first = adapter.adapt(fixture.liveIncoming);
    const duplicate = adapter.adapt(fixture.liveIncoming);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      type: "message.upsert",
      message: { id: "4001" }
    });
    expect(duplicate).toEqual([]);
    expect(adapter.reconnectCursor).toBe("4001");
  });

  it("does not suppress a reaction update with the same message time", () => {
    const adapter = new LiveEventAdapter({
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });
    const base = {
      chatId: "1001",
      message: {
        id: "reaction-live",
        senderId: fixture.viewerId,
        time: "2026-07-27T00:00:00.000Z",
        text: "Сообщение"
      }
    };

    const first = adapter.adapt({
      ...base,
      message: {
        ...base.message,
        reactions: [{
          key: "like",
          emoji: "👍",
          count: 1,
          selectedByMe: false
        }]
      }
    });
    const changed = adapter.adapt({
      ...base,
      message: {
        ...base.message,
        reactions: [{
          key: "like",
          emoji: "👍",
          count: 2,
          selectedByMe: true
        }]
      }
    });

    expect(first).toHaveLength(1);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      type: "message.upsert",
      message: {
        reactions: [{
          key: "like",
          count: 2,
          selectedByMe: true
        }]
      }
    });
  });

  it("adapts deletions and rejects unknown shapes with a public error", () => {
    const adapter = new LiveEventAdapter({
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });

    expect(adapter.adapt(fixture.liveDeleted)[0]).toMatchObject({
      type: "message.deleted",
      chatId: "1001",
      messageId: "4001"
    });
    expect(() => adapter.adapt(fixture.unknown))
      .toThrow(MaxCompatibilityError);
    try {
      adapter.adapt(fixture.unknown);
    } catch (error: unknown) {
      expect(error).toMatchObject({
        code: "max_wire_incompatible",
        message: "MAX event shape is not supported"
      });
      expect(JSON.stringify(error)).not.toContain("unexpected");
    }
  });

  it("does not log message bodies", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error")
      .mockImplementation(() => undefined);
    const adapter = new LiveEventAdapter({
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });

    adapter.adapt(fixture.liveIncoming);

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

async function loadFixture(): Promise<DomainFixture> {
  const source = await readFile(
    new URL("../../tests/fixtures/synthetic-domain-wire.json", import.meta.url),
    "utf8"
  );
  return JSON.parse(source) as DomainFixture;
}
