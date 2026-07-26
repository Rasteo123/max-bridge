import {
  parseMessage,
  type DeliveryStatus,
  type Message
} from "@maxbridge/core";

import { MaxCompatibilityError } from "./errors.js";
import type { RuntimeMediaAdapter } from "./media-adapter.js";
import {
  asWireRecord,
  boundedText,
  readOpaqueId,
  readWireArray,
  readWireBoolean,
  readWireString,
  requireOpaqueId,
  toIsoTimestamp,
  type WireRecord
} from "./wire-values.js";

export type HistoryPage = Readonly<{
  messages: readonly Message[];
  nextCursor?: string;
  hasMore: boolean;
}>;

export type MessageAdapterContext = Readonly<{
  chatId: string;
  viewerId: string;
  media: RuntimeMediaAdapter;
}>;

export function adaptHistoryPage(
  payload: unknown,
  context: MessageAdapterContext
): HistoryPage {
  const root = asWireRecord(payload);
  const rawMessages = readWireArray(root, "messages", "items", "history");
  if (rawMessages === undefined) {
    throw new MaxCompatibilityError();
  }
  const messages = rawMessages.map((value) =>
    adaptWireMessage(value, context)
  );
  const explicitCursor = readOpaqueId(
    root,
    "cursor",
    "nextCursor",
    "from"
  );
  const oldest = messages[0]?.id;
  const nextCursor = explicitCursor ?? oldest;
  return {
    messages,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    hasMore: readWireBoolean(root, "hasMore")
      ?? messages.length > 0
  };
}

export function adaptWireMessage(
  value: unknown,
  context: MessageAdapterContext
): Message {
  const message = asWireRecord(value);
  const id = requireOpaqueId(message, "id", "messageId", "cid");
  const senderId = readOpaqueId(message, "sender", "senderId", "authorId")
    ?? "0";
  const deleted = readWireBoolean(message, "deleted", "isDeleted") ?? false;
  const type = readWireString(message, "type", "messageType")
    ?.toUpperCase();
  const base = {
    id,
    chatId: context.chatId,
    senderId,
    ...(readWireString(message, "senderName", "authorName") === undefined
      ? {}
      : {
        senderName: boundedText(
          readWireString(message, "senderName", "authorName"),
          256
        )
      }),
    direction: senderId === context.viewerId
      ? "outgoing" as const
      : "incoming" as const,
    sentAt: toIsoTimestamp(
      message["time"] ?? message["sentAt"] ?? message["timestamp"]
    ),
    status: messageStatus(message),
    ...(readOpaqueId(message, "replyToId", "replyTo") === undefined
      ? {}
      : { replyToId: readOpaqueId(message, "replyToId", "replyTo") }),
    ...(readWireBoolean(message, "edited", "isEdited") === undefined
      ? {}
      : { edited: readWireBoolean(message, "edited", "isEdited") }),
    ...(deleted ? { deleted: true } : {})
  };

  if (deleted) {
    return parseMessage({
      ...base,
      kind: "text",
      text: "Сообщение удалено"
    });
  }
  if (
    type?.includes("SYSTEM") === true
    || type?.includes("CONTROL") === true
  ) {
    return parseMessage({
      ...base,
      kind: "system",
      text: boundedText(
        readWireString(message, "text", "message"),
        65_536,
        "Системное событие"
      ) || "Системное событие"
    });
  }

  const attachment = readWireArray(
    message,
    "attaches",
    "attachments"
  )?.[0];
  if (attachment !== undefined) {
    const adapted = context.media.adaptAttachment(attachment, {
      chatId: context.chatId,
      messageId: id,
      index: 0
    });
    const text = displayText(readWireString(message, "text", "message"));
    return parseMessage({
      ...base,
      kind: adapted.kind,
      media: adapted.metadata,
      ...(text === undefined ? {} : {
        text: boundedText(text, 65_536)
      })
    });
  }

  const text = boundedText(
    displayText(readWireString(message, "text", "message")),
    65_536,
    "Сообщение"
  );
  return parseMessage({
    ...base,
    kind: "text",
    text: text.length === 0 ? "Сообщение" : text
  });
}

function displayText(value: string | undefined): string | undefined {
  return value === "welcome.saved.dialog.message"
    ? "Сохраняйте здесь сообщения, фото и файлы"
    : value;
}

function messageStatus(message: WireRecord): DeliveryStatus {
  const raw = readWireString(message, "status", "deliveryStatus")
    ?.toLowerCase();
  if (
    raw === "pending"
    || raw === "sent"
    || raw === "delivered"
    || raw === "read"
    || raw === "failed"
  ) {
    return raw;
  }
  return "sent";
}
