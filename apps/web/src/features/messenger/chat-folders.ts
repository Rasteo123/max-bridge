import type { MessengerChat } from "./types.js";

export type ChatFolderId = "all" | "unread" | "channels";

export type ChatFolder = Readonly<{
  id: ChatFolderId;
  label: string;
}>;

// Mirrors the tab strip of the MAX web client.
export const CHAT_FOLDERS: readonly ChatFolder[] = [
  { id: "all", label: "Все" },
  { id: "unread", label: "Новые" },
  { id: "channels", label: "Каналы" }
];

export function chatsInFolder(
  chats: readonly MessengerChat[],
  folder: ChatFolderId
): readonly MessengerChat[] {
  if (folder === "all") {
    return chats;
  }
  if (folder === "unread") {
    return chats.filter((chat) => chat.unreadCount > 0);
  }
  return chats.filter((chat) => chat.kind === "channel");
}

export function folderIndexOf(folder: ChatFolderId): number {
  const index = CHAT_FOLDERS.findIndex((entry) => entry.id === folder);
  return index < 0 ? 0 : index;
}

export function folderAt(index: number): ChatFolderId {
  return CHAT_FOLDERS[
    Math.min(Math.max(0, index), CHAT_FOLDERS.length - 1)
  ]?.id ?? "all";
}
