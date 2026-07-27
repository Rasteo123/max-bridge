import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  parseBridgeEvent,
  parseChatSummary,
  parseMessage,
  parseStickerSummary,
  parseUserRecord,
  USER_STATES
} from "./index.js";

const syntheticChat = {
  id: "chat_synthetic_1",
  kind: "direct",
  title: "Синтетический контакт",
  preview: "Синтетическое сообщение",
  timestamp: "2026-07-26T12:00:00.000Z",
  unreadCount: 2,
  muted: false
} as const;

describe("user domain", () => {
  it.each(USER_STATES)("accepts the %s state", (state) => {
    expect(parseUserRecord({
      lookupId: "u_0123456789abcdef",
      state,
      createdAt: "2026-07-26T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:00.000Z"
    }).state).toBe(state);
  });

  it("rejects an unknown state", () => {
    expect(() => parseUserRecord({
      lookupId: "u_0123456789abcdef",
      state: "public",
      createdAt: "2026-07-26T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:00.000Z"
    })).toThrow(DomainValidationError);
  });

  it("rejects unknown fields", () => {
    expect(() => parseUserRecord({
      lookupId: "u_0123456789abcdef",
      state: "pending",
      createdAt: "2026-07-26T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:00.000Z",
      telegramId: "must-not-cross-domain-boundary"
    })).toThrow(DomainValidationError);
  });
});

describe("chat summary domain", () => {
  it("accepts a messenger row", () => {
    expect(parseChatSummary(syntheticChat)).toEqual(syntheticChat);
  });

  it("accepts an allowlisted MAX avatar URL", () => {
    const avatarUrl = "https://i.oneme.ru/i?id=synthetic";
    expect(parseChatSummary({
      ...syntheticChat,
      avatarUrl
    }).avatarUrl).toBe(avatarUrl);
  });

  it("accepts an optional pinned state", () => {
    expect(parseChatSummary({
      ...syntheticChat,
      pinned: true
    }).pinned).toBe(true);
  });

  it("accepts strict presence, direction and delivery state", () => {
    expect(parseChatSummary({
      ...syntheticChat,
      presence: "online",
      lastMessageDirection: "outgoing",
      deliveryStatus: "read"
    })).toMatchObject({
      presence: "online",
      lastMessageDirection: "outgoing",
      deliveryStatus: "read"
    });
  });

  it.each([
    "online",
    "offline",
    "recently",
    "long_ago",
    "unknown"
  ] as const)(
    "accepts the %s presence",
    (presence) => {
      expect(parseChatSummary({
        ...syntheticChat,
        presence
      }).presence).toBe(presence);
    }
  );

  it("accepts a bounded epoch-millisecond last-seen time", () => {
    const lastSeenAt = Date.parse("2026-07-27T09:55:00.000Z");

    expect(parseChatSummary({
      ...syntheticChat,
      presence: "offline",
      lastSeenAt
    }).lastSeenAt).toBe(lastSeenAt);
  });

  it.each([
    ["seconds", 1_785_146_400],
    ["negative", -1],
    ["not finite", Number.NaN],
    ["fractional", 1_785_146_400_000.5],
    ["too far in the future", 4_102_444_800_001],
    ["string", "1785146400000"],
    ["boolean", true]
  ] as const)("rejects %s as lastSeenAt", (_label, lastSeenAt) => {
    expect(() => parseChatSummary({
      ...syntheticChat,
      presence: "offline",
      lastSeenAt
    })).toThrow(DomainValidationError);
  });

  it.each(["incoming", "outgoing"] as const)(
    "accepts the %s last-message direction",
    (lastMessageDirection) => {
      expect(parseChatSummary({
        ...syntheticChat,
        lastMessageDirection
      }).lastMessageDirection).toBe(lastMessageDirection);
    }
  );

  it("rejects an unknown presence", () => {
    expect(() => parseChatSummary({
      ...syntheticChat,
      presence: "maybe"
    })).toThrow(DomainValidationError);
  });

  it("rejects an unknown last-message direction", () => {
    expect(() => parseChatSummary({
      ...syntheticChat,
      lastMessageDirection: "sideways"
    })).toThrow(DomainValidationError);
  });

  it("rejects an avatar URL outside the MAX image host", () => {
    expect(() => parseChatSummary({
      ...syntheticChat,
      avatarUrl: "https://example.test/avatar.png"
    })).toThrow(DomainValidationError);
  });

  it("rejects a negative unread count", () => {
    expect(() => parseChatSummary({
      ...syntheticChat,
      unreadCount: -1
    })).toThrow(DomainValidationError);
  });

  it("rejects oversized display strings", () => {
    expect(() => parseChatSummary({
      ...syntheticChat,
      title: "x".repeat(257)
    })).toThrow(DomainValidationError);
  });
});

describe("message domain", () => {
  it.each(["text", "image", "video", "voice", "file", "system"] as const)(
    "accepts a valid %s message",
    (kind) => {
      const content = kind === "text" || kind === "system"
        ? { text: "Синтетический текст" }
        : {
            media: {
              handle: `media_${kind}`,
              mimeType: "application/octet-stream",
              size: 128
            }
          };
      const message = {
        id: `message_${kind}`,
        chatId: syntheticChat.id,
        senderId: "sender_synthetic",
        senderName: "Синтетический отправитель",
        direction: "incoming",
        kind,
        sentAt: "2026-07-26T12:01:00.000Z",
        status: "delivered",
        ...content
      };

      expect(parseMessage(message).kind).toBe(kind);
    }
  );

  it("requires text for a text message", () => {
    expect(() => parseMessage({
      id: "message_text",
      chatId: syntheticChat.id,
      senderId: "sender_synthetic",
      direction: "incoming",
      kind: "text",
      sentAt: "2026-07-26T12:01:00.000Z",
      status: "delivered"
    })).toThrow(DomainValidationError);
  });

  it("requires media metadata for a media message", () => {
    expect(() => parseMessage({
      id: "message_image",
      chatId: syntheticChat.id,
      senderId: "sender_synthetic",
      direction: "incoming",
      kind: "image",
      sentAt: "2026-07-26T12:01:00.000Z",
      status: "delivered"
    })).toThrow(DomainValidationError);
  });

  it("preserves a bounded forwarded-message source", () => {
    const forwarded = parseMessage({
      id: "message_forwarded",
      chatId: syntheticChat.id,
      senderId: "sender_synthetic",
      direction: "incoming",
      kind: "text",
      text: "Пересланный текст",
      sentAt: "2026-07-26T12:01:00.000Z",
      status: "delivered",
      forwardedFrom: "ВСЕ ОТКРЫТКИ ТУТ"
    });

    expect(forwarded.forwardedFrom).toBe("ВСЕ ОТКРЫТКИ ТУТ");
  });

  it("preserves a strict forwarded source and emoji-safe HTTPS links", () => {
    const forwarded = parseMessage({
      id: "message_forwarded_rich",
      chatId: syntheticChat.id,
      senderId: "sender_synthetic",
      direction: "incoming",
      kind: "image",
      text: "Доброе утро 🌻 открыть",
      textLinks: [{
        offset: 15,
        length: 7,
        url: "https://max.ru/channel/synthetic"
      }],
      media: {
        handle: "media_forwarded",
        mimeType: "image/jpeg",
        size: 128
      },
      sentAt: "2026-07-26T12:01:00.000Z",
      status: "delivered",
      forwardedSource: {
        title: "ВСЕ ОТКРЫТКИ ТУТ",
        chatId: "-68429202642371",
        kind: "channel"
      }
    });

    expect(forwarded.forwardedSource).toEqual({
      title: "ВСЕ ОТКРЫТКИ ТУТ",
      chatId: "-68429202642371",
      kind: "channel"
    });
    expect(forwarded.textLinks).toEqual([{
      offset: 15,
      length: 7,
      url: "https://max.ru/channel/synthetic"
    }]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "http://example.test/plain",
    "https://user:password@example.test/private"
  ])("rejects unsafe rich-text URL %s", (url) => {
    expect(() => parseMessage({
      id: "message_unsafe_link",
      chatId: syntheticChat.id,
      senderId: "sender_synthetic",
      direction: "incoming",
      kind: "text",
      text: "Ссылка",
      textLinks: [{ offset: 0, length: 6, url }],
      sentAt: "2026-07-26T12:01:00.000Z",
      status: "delivered"
    })).toThrow(DomainValidationError);
  });

  it("accepts an explicit unsupported attachment message", () => {
    const unsupported = parseMessage({
      id: "message_unsupported",
      chatId: syntheticChat.id,
      senderId: "sender_synthetic",
      direction: "incoming",
      kind: "unsupported",
      text: "Неподдерживаемое вложение: LOCATION",
      attachmentType: "LOCATION",
      sentAt: "2026-07-26T12:01:00.000Z",
      status: "delivered"
    });

    expect(unsupported).toMatchObject({
      kind: "unsupported",
      attachmentType: "LOCATION"
    });
  });

  it("accepts omitted and empty message reactions", () => {
    const message = {
      id: "message_reactions",
      chatId: syntheticChat.id,
      senderId: "sender_synthetic",
      direction: "incoming",
      kind: "text",
      text: "Синтетический текст",
      sentAt: "2026-07-26T12:01:00.000Z",
      status: "delivered"
    } as const;

    expect(parseMessage(message)).toEqual(message);
    expect(parseMessage({
      ...message,
      reactions: []
    }).reactions).toEqual([]);
    expect(parseMessage({
      ...message,
      reactions: [{
        key: "heart",
        emoji: "❤️",
        count: 2,
        selectedByMe: true
      }]
    }).reactions).toEqual([{
      key: "heart",
      emoji: "❤️",
      count: 2,
      selectedByMe: true
    }]);
  });

  it("rejects unknown reaction keys", () => {
    expect(() => parseMessage({
      id: "message_reactions",
      chatId: syntheticChat.id,
      senderId: "sender_synthetic",
      direction: "incoming",
      kind: "text",
      text: "Синтетический текст",
      sentAt: "2026-07-26T12:01:00.000Z",
      status: "delivered",
      reactions: [{
        key: "unknown",
        emoji: "⭐",
        count: 1,
        selectedByMe: false
      }]
    })).toThrow(DomainValidationError);
  });

  it("accepts only bounded image data URLs for sticker previews", () => {
    const sticker = {
      id: "sticker-1",
      previewDataUrl: `data:image/png;base64,${"A".repeat(32)}`
    };
    expect(parseStickerSummary(sticker)).toEqual(sticker);
    expect(() => parseStickerSummary({
      id: "sticker-1",
      previewDataUrl: "https://attacker.invalid/sticker.png"
    })).toThrow(DomainValidationError);
    expect(() => parseStickerSummary({
      id: "sticker-1",
      previewDataUrl: `data:image/webp;base64,${"A".repeat(41 * 1024)}`
    })).toThrow(DomainValidationError);
  });
});

describe("bridge event domain", () => {
  it("accepts a chat snapshot", () => {
    const event = parseBridgeEvent({
      type: "chats.snapshot",
      sequence: 1,
      occurredAt: "2026-07-26T12:02:00.000Z",
      chats: [syntheticChat]
    });

    expect(event.type).toBe("chats.snapshot");
  });

  it("rejects an event with an empty opaque id", () => {
    expect(() => parseBridgeEvent({
      type: "message.deleted",
      sequence: 2,
      occurredAt: "2026-07-26T12:02:00.000Z",
      chatId: "",
      messageId: "message_1"
    })).toThrow(DomainValidationError);
  });
});
