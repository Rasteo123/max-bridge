import {
  parseChatSummary,
  type ChatKind,
  type ChatSummary
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
    kind: chatKind(chat),
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
    ...(avatarUrl === undefined ? {} : { avatarUrl })
  };
  return parseChatSummary(summary);
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
