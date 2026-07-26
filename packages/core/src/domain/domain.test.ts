import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  parseBridgeEvent,
  parseChatSummary,
  parseMessage,
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
