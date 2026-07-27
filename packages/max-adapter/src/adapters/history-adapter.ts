import {
  REACTION_KEYS,
  parseMessage,
  type DeliveryStatus,
  type Message,
  type MessageReaction,
  type ReactionKey
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
  toIsoTimestamp
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
  const reactions = adaptReactions(
    readWireArray(message, "reactions", "reactionSummary")
  );
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
    status: normalizeDeliveryStatus(
      readWireString(message, "status", "deliveryStatus")
    ),
    ...(readOpaqueId(message, "replyToId", "replyTo") === undefined
      ? {}
      : { replyToId: readOpaqueId(message, "replyToId", "replyTo") }),
    ...(readWireString(message, "forwardedFrom") === undefined
      ? {}
      : {
        forwardedFrom: boundedText(
          readWireString(message, "forwardedFrom"),
          256
        )
      }),
    ...(readWireBoolean(message, "edited", "isEdited") === undefined
      ? {}
      : { edited: readWireBoolean(message, "edited", "isEdited") }),
    ...(deleted ? { deleted: true } : {}),
    ...(reactions.length === 0 ? {} : { reactions })
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

function adaptReactions(
  values: readonly unknown[] | undefined
): MessageReaction[] {
  if (values === undefined) {
    return [];
  }
  return values.slice(0, REACTION_KEYS.length).flatMap((value) => {
    const reaction = asWireRecord(value);
    const keyValue = reaction["key"];
    const emoji = reaction["emoji"];
    const count = reaction["count"];
    const selectedByMe = reaction["selectedByMe"];
    if (
      typeof keyValue !== "string"
      || !isReactionKey(keyValue)
      || typeof emoji !== "string"
      || emoji.length < 1
      || emoji.length > 32
      || typeof count !== "number"
      || !Number.isSafeInteger(count)
      || count < 1
      || count > 999_999
      || typeof selectedByMe !== "boolean"
    ) {
      return [];
    }
    return [{ key: keyValue, emoji, count, selectedByMe }];
  });
}

function isReactionKey(value: string): value is ReactionKey {
  return (REACTION_KEYS as readonly string[]).includes(value);
}

function displayText(value: string | undefined): string | undefined {
  return value === "welcome.saved.dialog.message"
    ? "Сохраняйте здесь сообщения, фото и файлы"
    : value;
}

export function normalizeDeliveryStatus(
  value: string | undefined
): DeliveryStatus {
  switch (value?.toUpperCase()) {
    case "PENDING":
      return "pending";
    case "SENT":
      return "sent";
    case "ACKNOWLEDGED":
    case "DELIVERED":
      return "delivered";
    case "SEEN":
    case "READ":
      return "read";
    case "FAILED":
    case "FAILURE":
    case "ERROR":
    case "REJECTED":
    case "CANCELED":
    case "CANCELLED":
      return "failed";
    default:
      return "sent";
  }
}
