export type MessengerChat = Readonly<{
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  formattedTime?: string;
  unreadCount: number;
  muted: boolean;
  kind: "direct" | "group" | "channel";
  avatarUrl?: string;
  deliveryStatus?: "pending" | "sent" | "delivered" | "read" | "failed";
}>;

export type MessengerMessage = Readonly<{
  id: string;
  chatId?: string;
  kind?: "text" | "system" | "image" | "video" | "voice" | "file";
  text: string;
  direction: "incoming" | "outgoing";
  sentAt: string;
  formattedTime?: string;
  senderName?: string;
  status?: "pending" | "sent" | "delivered" | "read" | "failed";
  media?: MessengerMedia;
}>;

export type MessengerPane = "list" | "conversation";
export type MessengerTheme = "system" | "light" | "dark";

export type MessengerMedia = Readonly<{
  handle: string;
  mimeType: string;
  size: number;
  fileName?: string;
  durationMs?: number;
  width?: number;
  height?: number;
}>;

type EventBase = Readonly<{
  sequence: number;
  occurredAt: string;
}>;

export type MessengerEvent =
  | (EventBase & Readonly<{
    type: "chats.snapshot";
    chats: readonly MessengerChat[];
  }>)
  | (EventBase & Readonly<{
    type: "chat.upsert";
    chat: MessengerChat;
  }>)
  | (EventBase & Readonly<{
    type: "message.upsert";
    message: MessengerMessage;
  }>)
  | (EventBase & Readonly<{
    type: "message.deleted";
    chatId: string;
    messageId: string;
  }>)
  | (EventBase & Readonly<{
    type: "connection.state";
    state: "connected" | "reconnecting" | "disconnected";
  }>)
  | (EventBase & Readonly<{
    type: "authentication.state";
    state: "active" | "reauth_required";
  }>);
