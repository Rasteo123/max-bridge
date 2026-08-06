import {
  MAX_DISTINCT_REACTIONS,
  parseMessage,
  type DeliveryStatus,
  type Message,
  type MessageReaction
} from "@maxbridge/core";

import { MaxCompatibilityError } from "./errors.js";
import type { RuntimeMediaAdapter } from "./media-adapter.js";
import {
  asWireRecord,
  boundedText,
  optionalWireRecord,
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
  const forwardedSource = adaptForwardedSource(
    optionalWireRecord(message["forwardedSource"])
  );
  const legacyForwardedFrom = readWireString(message, "forwardedFrom");
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
    ...(legacyForwardedFrom === undefined && forwardedSource === undefined
      ? {}
      : {
        forwardedFrom: boundedText(
          legacyForwardedFrom ?? forwardedSource?.title,
          256
        )
      }),
    ...(forwardedSource === undefined ? {} : { forwardedSource }),
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
    const attachmentRecord = optionalWireRecord(attachment);
    const rawAttachmentType = attachmentRecord === undefined
      ? undefined
      : readWireString(
        attachmentRecord,
        "_type",
        "type",
        "kind",
        "mediaType"
      );
    const normalizedAttachmentType = rawAttachmentType
      ?.toUpperCase()
      .slice(0, 64);
    const text = boundedText(
      displayText(readWireString(message, "text", "message", "caption")),
      65_536
    );
    const textLinks = adaptTextLinks(message["textLinks"], text);
    if (!isSupportedAttachmentType(normalizedAttachmentType)) {
      const fallback = normalizedAttachmentType === undefined
        ? "Неподдерживаемое вложение"
        : `Неподдерживаемое вложение: ${normalizedAttachmentType}`;
      return parseMessage({
        ...base,
        kind: "unsupported",
        text: text.length === 0 ? fallback : text,
        ...(normalizedAttachmentType === undefined
          ? {}
          : { attachmentType: normalizedAttachmentType }),
        ...(textLinks.length === 0 ? {} : { textLinks })
      });
    }
    const adapted = context.media.adaptAttachment(attachment, {
      chatId: context.chatId,
      messageId: id,
      index: 0
    });
    return parseMessage({
      ...base,
      kind: adapted.kind,
      media: adapted.metadata,
      ...(text.length === 0 ? {} : { text }),
      ...(textLinks.length === 0 ? {} : { textLinks })
    });
  }

  const text = boundedText(
    displayText(readWireString(message, "text", "message", "caption")),
    65_536,
    "Сообщение"
  );
  const textLinks = adaptTextLinks(message["textLinks"], text);
  return parseMessage({
    ...base,
    kind: "text",
    text: text.length === 0 ? "Сообщение" : text,
    ...(textLinks.length === 0 ? {} : { textLinks })
  });
}

function adaptForwardedSource(
  value: Readonly<Record<string, unknown>> | undefined
): Readonly<{
  title: string;
  chatId: string;
  kind: "direct" | "group" | "channel";
}> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const title = boundedText(readWireString(value, "title"), 256);
  const chatId = readOpaqueId(value, "chatId");
  const kind = readWireString(value, "kind");
  if (
    title.length === 0 ||
    chatId === undefined ||
    (kind !== "direct" && kind !== "group" && kind !== "channel")
  ) {
    return undefined;
  }
  return { title, chatId, kind };
}

function adaptTextLinks(
  value: unknown,
  text: string
): readonly Readonly<{
  offset: number;
  length: number;
  url: string;
}>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    return [];
  }
  const textLength = Array.from(text).length;
  const output: Array<Readonly<{
    offset: number;
    length: number;
    url: string;
  }>> = [];
  for (const item of value) {
    const record = optionalWireRecord(item);
    const offset = record?.["offset"];
    const length = record?.["length"];
    const url = record?.["url"];
    if (
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      offset + length > textLength ||
      typeof url !== "string" ||
      !isSafeHttpsUrl(url)
    ) {
      return [];
    }
    output.push({ offset, length, url });
  }
  const ordered = [...output].sort((left, right) =>
    left.offset - right.offset
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.offset + previous.length > current.offset
    ) {
      return [];
    }
  }
  return ordered;
}

function isSafeHttpsUrl(value: string): boolean {
  if (value.length > 4_096) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function isSupportedAttachmentType(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return value.includes("PHOTO") ||
    value.includes("IMAGE") ||
    value.includes("STICKER") ||
    value.includes("VIDEO") ||
    value.includes("VOICE") ||
    value.includes("AUDIO") ||
    value.includes("FILE");
}

function adaptReactions(
  values: readonly unknown[] | undefined
): MessageReaction[] {
  if (values === undefined) {
    return [];
  }
  return values.slice(0, MAX_DISTINCT_REACTIONS).flatMap((value) => {
    const reaction = asWireRecord(value);
    const emoji = reaction["emoji"];
    const count = reaction["count"];
    const selectedByMe = reaction["selectedByMe"];
    if (
      typeof emoji !== "string"
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
    return [{ emoji, count, selectedByMe }];
  });
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
