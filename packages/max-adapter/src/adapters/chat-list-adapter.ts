import {
  parseChatSummary,
  type ChatKind,
  type ChatSummary,
  type LastMessageDirection,
  type Presence
} from "@maxbridge/core";

import { MaxCompatibilityError } from "./errors.js";
import type { RuntimeMediaAdapter } from "./media-adapter.js";
import { deliveryStatus } from "./wire-message-adapter.js";
import {
  asWireRecord,
  boundedInteger,
  boundedText,
  optionalWireRecord,
  readOpaqueId,
  readWireArray,
  readWireBoolean,
  readWireNumber,
  readWireString,
  requireOpaqueId,
  toIsoTimestamp,
  type WireRecord
} from "./wire-values.js";

export type ChatListPage = Readonly<{
  chats: readonly ChatSummary[];
  nextCursor?: string;
  hasMore: boolean;
}>;

export function adaptChatList(
  payload: unknown,
  context: Readonly<{ media: RuntimeMediaAdapter }>
): ChatListPage {
  const root = asWireRecord(payload);
  const rawChats = readWireArray(
    root,
    "chats",
    "items",
    "dialogs",
    "conversations"
  );
  if (rawChats === undefined) {
    throw new MaxCompatibilityError();
  }
  const chats = rawChats
    .map((value) => adaptChatSummary(value, context.media))
    .sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp)
    );
  const nextCursor = readOpaqueId(root, "cursor", "nextCursor", "chatsSync");
  return {
    chats,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    hasMore: readWireBoolean(root, "hasMore") ?? false
  };
}

function adaptChatSummary(
  value: unknown,
  media: RuntimeMediaAdapter
): ChatSummary {
  const chat = asWireRecord(value);
  const id = requireOpaqueId(chat, "id", "chatId");
  const lastMessage = optionalWireRecord(
    chat["lastMessage"] ?? chat["message"]
  );
  const kind = chatKind(chat);
  const presenceState = chatPresence(chat, kind);
  const verified = readWireBoolean(chat, "verified") ?? false;
  const maxLink = maxAddress(readWireString(chat, "link"));
  const lastMessageDirection = messageDirection(chat, lastMessage);
  const timestamp = toIsoTimestamp(
    lastMessage?.["time"]
      ?? chat["lastMessageTime"]
      ?? chat["time"]
      ?? chat["updateTime"]
  );
  const title = boundedText(
    readWireString(chat, "title", "name", "displayName"),
    256,
    "Чат"
  ).trim() || "Чат";
  const avatarHandle = media.registerAvatar(id, chat);
  const avatarUrl = safeAvatarUrl(
    readWireString(chat, "avatarUrl", "avatarURL")
  );
  const summary = {
    id,
    kind,
    title,
    preview: messagePreview(lastMessage),
    timestamp,
    unreadCount: boundedInteger(
      readWireNumber(chat, "unread", "unreadCount"),
      0,
      9_999
    ),
    muted: isMuted(chat),
    pinned: readWireBoolean(chat, "pinned", "isPinned") ?? false,
    ...(avatarHandle === undefined ? {} : { avatarHandle }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    ...(verified ? { verified: true } : {}),
    ...(maxLink === undefined ? {} : { link: maxLink }),
    ...(presenceState.presence === undefined
      ? {}
      : { presence: presenceState.presence }),
    ...(presenceState.lastSeenAt === undefined
      ? {}
      : { lastSeenAt: presenceState.lastSeenAt }),
    ...(lastMessageDirection === undefined ? {} : { lastMessageDirection }),
    ...(lastMessage === undefined || lastMessageDirection === undefined
      ? {}
      : {
        deliveryStatus: deliveryStatus(
          lastMessageDirection,
          Date.parse(timestamp),
          readMarks(chat)
        )
      })
  };
  return parseChatSummary(summary);
}

function maxAddress(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 2_048) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "max.ru"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Read markers of everyone but the viewer, in epoch milliseconds. */
function readMarks(chat: WireRecord): readonly number[] {
  const marks = readWireArray(chat, "readMarks");
  if (marks === undefined) {
    return [];
  }
  return marks.filter((mark): mark is number =>
    typeof mark === "number" && Number.isSafeInteger(mark) && mark > 0
  );
}

const ONLINE_WINDOW_MS = 2 * 60_000;
const RECENTLY_WINDOW_MS = 60 * 60_000;
const LONG_AGO_WINDOW_MS = 7 * 24 * 60 * 60_000;

function chatPresence(
  chat: WireRecord,
  kind: ChatKind
): Readonly<{
  presence?: Presence;
  lastSeenAt?: number;
}> {
  if (kind !== "direct") {
    return {};
  }
  // MAX reports only when a contact was last seen; the states it shows are
  // derived from how long ago that was.
  const seenAt = readWireNumber(chat, "recipientSeenAt");
  if (seenAt !== undefined && Number.isSafeInteger(seenAt)) {
    const age = Date.now() - seenAt;
    if (age <= ONLINE_WINDOW_MS) {
      return { presence: "online" };
    }
    return {
      presence: age <= RECENTLY_WINDOW_MS
        ? "recently"
        : age <= LONG_AGO_WINDOW_MS
          ? "offline"
          : "long_ago",
      lastSeenAt: seenAt
    };
  }
  const recipient = optionalWireRecord(chat["recipient"]);
  const nestedPresence = optionalWireRecord(recipient?.["presence"]);
  const rawNestedPresence = optionalWireRecord(nestedPresence?.["$"]);
  const status = strictPresenceStatus(nestedPresence?.["status"]);
  if (status !== undefined) {
    const presence = ({
      0: "offline",
      1: "online",
      2: "recently",
      3: "long_ago"
    } as const)[status];
    if (presence !== "offline") {
      return { presence };
    }
    const lastSeenAt = trustedLastSeenAt(
      nestedPresence?.["seen"],
      rawNestedPresence?.["seen"]
    );
    return {
      presence,
      ...(lastSeenAt === undefined ? {} : { lastSeenAt })
    };
  }
  const recipientView = optionalWireRecord(recipient?.["view"]);
  const chatView = optionalWireRecord(chat["view"]);
  const online = (
    strictWireBoolean(nestedPresence?.["isOnline"])
    ?? (recipient === undefined
      ? undefined
      : readWireBoolean(recipient, "online", "isOnline"))
    ?? (recipientView === undefined
      ? undefined
      : readWireBoolean(recipientView, "online", "isOnline"))
    ?? (chatView === undefined
      ? undefined
      : readWireBoolean(chatView, "online", "isOnline"))
    ?? readWireBoolean(chat, "online", "isOnline")
  );
  if (online === true) {
    return { presence: "online" };
  }
  if (online === false) {
    const lastSeenAt = trustedLastSeenAt(
      nestedPresence?.["seen"],
      rawNestedPresence?.["seen"]
    );
    return {
      presence: "offline",
      ...(lastSeenAt === undefined ? {} : { lastSeenAt })
    };
  }
  return { presence: "unknown" };
}

const MAX_LAST_SEEN_AGE_MS = 10 * 366 * 24 * 60 * 60_000;
const MAX_LAST_SEEN_FUTURE_SKEW_MS = 5 * 60_000;
const MIN_EPOCH_MILLISECONDS = 946_684_800_000;
const MAX_EPOCH_MILLISECONDS = 4_102_444_800_000;
const MIN_EPOCH_SECONDS = MIN_EPOCH_MILLISECONDS / 1_000;
const MAX_EPOCH_SECONDS = MAX_EPOCH_MILLISECONDS / 1_000;

function strictPresenceStatus(value: unknown): 0 | 1 | 2 | 3 | undefined {
  return value === 0 || value === 1 || value === 2 || value === 3
    ? value
    : undefined;
}

function strictWireBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function trustedLastSeenAt(
  millisecondsValue: unknown,
  rawSecondsValue: unknown
): number | undefined {
  const milliseconds = strictEpochInteger(
    millisecondsValue,
    MIN_EPOCH_MILLISECONDS,
    MAX_EPOCH_MILLISECONDS
  );
  const rawSeconds = strictEpochInteger(
    rawSecondsValue,
    MIN_EPOCH_SECONDS,
    MAX_EPOCH_SECONDS
  );
  const candidate = milliseconds ?? (
    rawSeconds === undefined ? undefined : rawSeconds * 1_000
  );
  if (candidate === undefined || !Number.isSafeInteger(candidate)) {
    return undefined;
  }
  const now = Date.now();
  if (
    candidate < now - MAX_LAST_SEEN_AGE_MS
    || candidate > now + MAX_LAST_SEEN_FUTURE_SKEW_MS
  ) {
    return undefined;
  }
  return candidate;
}

function strictEpochInteger(
  value: unknown,
  minimum: number,
  maximum: number
): number | undefined {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
  )
    ? value
    : undefined;
}

function messageDirection(
  chat: WireRecord,
  lastMessage: WireRecord | undefined
): LastMessageDirection | undefined {
  if (lastMessage === undefined) {
    return undefined;
  }
  const lastSenderId = readOpaqueId(
    lastMessage,
    "sender",
    "senderId",
    "authorId"
  );
  const viewerId = readOpaqueId(chat, "viewerId");
  if (lastSenderId === undefined || viewerId === undefined) {
    return undefined;
  }
  return lastSenderId === viewerId ? "outgoing" : "incoming";
}

function safeAvatarUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 2_048) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "i.oneme.ru"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function chatKind(chat: WireRecord): ChatKind {
  const value = readWireString(chat, "type", "kind", "chatType")
    ?.toUpperCase();
  if (
    value?.includes("DIALOG") === true
    || value?.includes("DIRECT") === true
    || value?.includes("PRIVATE") === true
    || value?.includes("SAVED") === true
    || value?.includes("SELF") === true
  ) {
    return "direct";
  }
  if (
    value?.includes("CHANNEL") === true
    || value?.includes("BROADCAST") === true
  ) {
    return "channel";
  }
  return "group";
}

function messagePreview(message: WireRecord | undefined): string {
  if (message === undefined) {
    return "";
  }
  const text = readWireString(message, "text", "message");
  if (text !== undefined && text.length > 0) {
    return boundedText(text, 2_048);
  }
  const attachment = readWireArray(message, "attaches", "attachments")?.[0];
  const attachRecord = optionalWireRecord(attachment);
  const type = attachRecord === undefined
    ? undefined
    : readWireString(attachRecord, "_type", "type", "kind")?.toUpperCase();
  if (type?.includes("STICKER") === true) {
    return "Стикер";
  }
  if (type?.includes("PHOTO") === true || type?.includes("IMAGE") === true) {
    return "Изображение";
  }
  if (type?.includes("VIDEO") === true) {
    return "Видео";
  }
  if (type?.includes("AUDIO") === true || type?.includes("VOICE") === true) {
    return "Голосовое сообщение";
  }
  if (type !== undefined) {
    return "Файл";
  }
  return "";
}

function isMuted(chat: WireRecord): boolean {
  const explicit = readWireBoolean(chat, "muted", "isMuted");
  if (explicit !== undefined) {
    return explicit;
  }
  return readWireArray(chat, "options")?.some((option) =>
    typeof option === "string" && option.toUpperCase().includes("MUTE")
  ) ?? false;
}
