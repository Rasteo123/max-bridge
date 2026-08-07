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
  boundedInteger,
  boundedText,
  optionalWireRecord,
  readOpaqueId,
  readWireArray,
  readWireNumber,
  readWireString,
  requireOpaqueId,
  toIsoTimestamp
} from "./wire-values.js";

export type WireMessageContext = Readonly<{
  chatId: string;
  viewerId: string;
  media: RuntimeMediaAdapter;
  /**
   * Latest read marker of every other chat participant, in epoch milliseconds.
   * MAX carries no per-message status, so an outgoing message counts as read
   * once somebody else's marker reaches it.
   */
  readMarks?: readonly number[];
  senderNames?: ReadonlyMap<string, string>;
  /** Comment totals per post id, as returned by opcode 91 for channels. */
  commentCounts?: ReadonlyMap<string, number>;
}>;

const SUPPORTED_MEDIA_TYPES = new Set([
  "PHOTO",
  "VIDEO",
  "AUDIO",
  "FILE",
  "STICKER",
  "SHARE"
]);

export function adaptWireHistory(
  payload: unknown,
  context: WireMessageContext
): readonly Message[] {
  const root = asWireRecord(payload);
  const rawMessages = readWireArray(root, "messages");
  if (rawMessages === undefined) {
    throw new MaxCompatibilityError();
  }
  return rawMessages.flatMap((value) => {
    try {
      return [adaptWireHistoryMessage(value, context)];
    } catch {
      // A single unfamiliar message must not blank out the whole history.
      return [];
    }
  });
}

export function adaptWireHistoryMessage(
  value: unknown,
  context: WireMessageContext
): Message {
  const message = asWireRecord(value);
  const id = requireOpaqueId(message, "id");
  const senderId = readOpaqueId(message, "sender", "senderId") ?? "0";
  const sentAt = toIsoTimestamp(message["time"]);
  const sentAtMs = Date.parse(sentAt);
  const direction = senderId === context.viewerId ? "outgoing" : "incoming";
  const type = readWireString(message, "type")?.toUpperCase();
  // A forwarded message is an empty shell: its text, attachments and
  // formatting all live on the message carried inside `link`.
  const views = boundedInteger(
    readWireNumber(optionalWireRecord(message["stats"]) ?? {}, "views"),
    0,
    1_000_000_000
  ) || undefined;
  const commentCount = context.commentCounts?.get(
    readOpaqueId(message, "id") ?? ""
  );
  const forward = forwardedLink(message);
  const content = forward?.content ?? message;
  const attachments = readWireArray(content, "attaches") ?? [];
  const attachment = optionalWireRecord(attachments[0]);
  const attachmentType = readWireString(attachment ?? {}, "_type")
    ?.toUpperCase();
  const text = boundedText(readableText(message), 65_536);
  const textLinks = adaptElements(content["elements"], text);
  const senderName = context.senderNames?.get(senderId);

  const base = {
    id,
    chatId: context.chatId,
    senderId,
    ...(senderName === undefined
      ? {}
      : { senderName: boundedText(senderName, 256) }),
    direction,
    sentAt,
    status: deliveryStatus(direction, sentAtMs, context.readMarks),
    ...(readOpaqueId(message, "replyToId") === undefined
      ? {}
      : { replyToId: readOpaqueId(message, "replyToId") }),
    ...(readWireNumber(message, "updateTime") === undefined
      ? {}
      : { edited: true }),
    ...(forward === undefined ? {} : { forwardedFrom: forward.title }),
    ...(forward?.source === undefined
      ? {}
      : { forwardedSource: forward.source }),
    ...(textLinks.length === 0 ? {} : { textLinks }),
    ...(adaptReactionInfo(message["reactionInfo"]).length === 0
      ? {}
      : { reactions: adaptReactionInfo(message["reactionInfo"]) }),
    ...(views === undefined ? {} : { views }),
    ...(commentCount === undefined ? {} : { commentCount })
  };

  if (attachmentType === "CONTROL" || type?.includes("CONTROL") === true) {
    return parseMessage({
      ...base,
      kind: "system",
      text: controlText(attachment) || "Системное событие"
    });
  }
  if (attachmentType === "CALL") {
    return parseMessage({
      ...base,
      kind: "system",
      text: callText(attachment, direction)
    });
  }
  if (attachment !== undefined && attachmentType !== undefined) {
    if (!SUPPORTED_MEDIA_TYPES.has(attachmentType)) {
      return parseMessage({
        ...base,
        kind: "unsupported",
        text: text.length === 0
          ? `Неподдерживаемое вложение: ${attachmentType}`
          : text,
        attachmentType: attachmentType.slice(0, 64)
      });
    }
    // A forwarded attachment belongs to the message inside `link`, and MAX
    // resolves its download link against that message in its own chat.
    const adapted = context.media.adaptAttachment(attachment, {
      chatId: forward?.source?.chatId ?? context.chatId,
      messageId: readOpaqueId(content, "id") ?? id,
      index: 0
    });
    return parseMessage({
      ...base,
      kind: adapted.kind,
      media: adapted.metadata,
      ...(text.length === 0 ? {} : { text })
    });
  }

  return parseMessage({
    ...base,
    kind: "text",
    text: text.length === 0 ? " " : text
  });
}

type ForwardedLink = Readonly<{
  content: Readonly<Record<string, unknown>>;
  title: string;
  source?: Readonly<{
    title: string;
    chatId: string;
    kind: "direct" | "group" | "channel";
  }>;
}>;

function forwardedLink(
  message: Readonly<Record<string, unknown>>
): ForwardedLink | undefined {
  const link = optionalWireRecord(message["link"]);
  if (
    link === undefined
    || readWireString(link, "type")?.toUpperCase() !== "FORWARD"
  ) {
    return undefined;
  }
  const content = optionalWireRecord(link["message"]);
  if (content === undefined) {
    return undefined;
  }
  const title = boundedText(readWireString(link, "chatName"), 256);
  const chatId = readOpaqueId(link, "chatId");
  if (title.length === 0) {
    return { content, title: "Переслано" };
  }
  return {
    content,
    title,
    ...(chatId === undefined
      ? {}
      : {
        source: {
          title,
          chatId,
          kind: forwardedKind(link, chatId)
        }
      })
  };
}

function forwardedKind(
  link: Readonly<Record<string, unknown>>,
  chatId: string
): "direct" | "group" | "channel" {
  if (readWireString(link, "chatAccessType") !== undefined) {
    return "channel";
  }
  return chatId.startsWith("-") ? "group" : "direct";
}

/**
 * MAX describes formatting as `elements` spans. Only links carry something the
 * Mini App can act on, and only those that survive validation are kept.
 */
function adaptElements(
  value: unknown,
  text: string
): readonly Readonly<{ offset: number; length: number; url: string }>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    return [];
  }
  // MAX counts spans in code points, which is what Array.from yields.
  const textLength = Array.from(text).length;
  const links: Array<Readonly<{
    offset: number;
    length: number;
    url: string;
  }>> = [];
  for (const item of value) {
    const element = optionalWireRecord(item);
    if (
      element === undefined
      || readWireString(element, "type")?.toUpperCase() !== "LINK"
    ) {
      continue;
    }
    const url = readWireString(
      optionalWireRecord(element["attributes"]) ?? {},
      "url"
    );
    const offset = readWireNumber(element, "from") ?? 0;
    const length = readWireNumber(element, "length");
    if (
      url === undefined
      || !isSafeHttpsUrl(url)
      || length === undefined
      || !Number.isSafeInteger(offset)
      || !Number.isSafeInteger(length)
      || offset < 0
      || length < 1
      || offset + length > textLength
    ) {
      continue;
    }
    links.push({ offset, length, url });
  }
  const ordered = [...links].sort((left, right) => left.offset - right.offset);
  return ordered.filter((link, index) => {
    const previous = ordered[index - 1];
    return previous === undefined
      || previous.offset + previous.length <= link.offset;
  });
}

function isSafeHttpsUrl(value: string): boolean {
  if (value.length < 9 || value.length > 4_096) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username.length === 0
      && parsed.password.length === 0
      && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function readableText(
  message: Readonly<Record<string, unknown>>
): string | undefined {
  const text = readWireString(message, "text");
  if (text !== undefined && text.length > 0) {
    return text === "welcome.saved.dialog.message"
      ? "Сохраняйте здесь сообщения, фото и файлы"
      : text;
  }
  const nested = optionalWireRecord(
    optionalWireRecord(message["link"])?.["message"]
  );
  return nested === undefined ? undefined : readWireString(nested, "text");
}

function controlText(
  attachment: Readonly<Record<string, unknown>> | undefined
): string {
  if (attachment === undefined) {
    return "";
  }
  return boundedText(
    readWireString(attachment, "message", "shortMessage"),
    65_536
  );
}

function callText(
  attachment: Readonly<Record<string, unknown>> | undefined,
  direction: "incoming" | "outgoing"
): string {
  const hangup = attachment === undefined
    ? undefined
    : readWireString(attachment, "hangupType")?.toUpperCase();
  if (hangup !== "HUNGUP" && direction === "incoming") {
    return "Пропущенный вызов";
  }
  const durationMs = attachment === undefined
    ? undefined
    : readWireNumber(attachment, "duration");
  const label = direction === "outgoing" ? "Исходящий вызов" : "Входящий вызов";
  return durationMs === undefined || durationMs <= 0
    ? label
    : `${label}, ${formatDuration(durationMs)}`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

export function deliveryStatus(
  direction: "incoming" | "outgoing",
  sentAtMs: number,
  readMarks: readonly number[] | undefined
): DeliveryStatus {
  if (direction === "incoming") {
    return "read";
  }
  if (readMarks === undefined || readMarks.length === 0) {
    return "sent";
  }
  return readMarks.some((mark) => mark >= sentAtMs) ? "read" : "delivered";
}

export function adaptReactionInfo(value: unknown): MessageReaction[] {
  const info = optionalWireRecord(value);
  if (info === undefined) {
    return [];
  }
  const mine = readWireString(info, "yourReaction");
  const counters = readWireArray(info, "counters") ?? [];
  return counters
    .slice(0, MAX_DISTINCT_REACTIONS)
    .flatMap((entry): MessageReaction[] => {
      const counter = optionalWireRecord(entry);
      const emoji = counter === undefined
        ? undefined
        : readWireString(counter, "reaction");
      const count = counter === undefined
        ? undefined
        : readWireNumber(counter, "count");
      if (
        emoji === undefined
        || emoji.length === 0
        || emoji.length > 32
        || count === undefined
        || !Number.isSafeInteger(count)
        || count < 1
        || count > 999_999
      ) {
        return [];
      }
      return [{ emoji, count, selectedByMe: emoji === mine }];
    });
}
