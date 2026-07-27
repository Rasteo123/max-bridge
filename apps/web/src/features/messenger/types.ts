export type DeliveryStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type MessengerChat = Readonly<{
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  formattedTime?: string;
  unreadCount: number;
  muted: boolean;
  pinned?: boolean;
  kind: "direct" | "group" | "channel";
  avatarUrl?: string;
  presence?: "online" | "offline" | "recently" | "long_ago" | "unknown";
  lastSeenAt?: number;
  lastMessageDirection?: "incoming" | "outgoing";
  deliveryStatus?: DeliveryStatus;
}>;

export type MessengerMessage = Readonly<{
  id: string;
  chatId?: string;
  kind?:
    | "text"
    | "system"
    | "image"
    | "video"
    | "voice"
    | "file"
    | "unsupported";
  text: string;
  direction: "incoming" | "outgoing";
  sentAt: string;
  formattedTime?: string;
  senderName?: string;
  status?: DeliveryStatus;
  media?: MessengerMedia;
  edited?: boolean;
  replyToId?: string;
  replyPreview?: MessengerReplyPreview;
  forwardedFrom?: string;
  forwardedSource?: MessengerForwardedSource;
  textLinks?: readonly MessengerTextLink[];
  attachmentType?: string;
  reactions?: readonly MessengerReaction[];
}>;

export type MessengerForwardedSource = Readonly<{
  title: string;
  chatId: string;
  kind: "direct" | "group" | "channel";
}>;

export type MessengerTextLink = Readonly<{
  offset: number;
  length: number;
  url: string;
}>;

export type MessengerPane = "list" | "conversation";
export type MessengerTheme = "system" | "light" | "dark";
export type MessengerChatAction =
  | "pin"
  | "unpin"
  | "mark_unread"
  | "mute"
  | "unmute"
  | "clear"
  | "delete";

export type ReactionKey =
  | "like"
  | "heart"
  | "laugh"
  | "fire"
  | "cry"
  | "celebrate";

export type MessengerReaction = Readonly<{
  key: ReactionKey;
  emoji: string;
  count: number;
  selectedByMe: boolean;
}>;

export type MessengerReplyPreview = Readonly<{
  messageId: string;
  senderName?: string;
  text: string;
}>;

export type MessengerSticker = Readonly<{
  id: string;
  previewDataUrl: string;
}>;

export type AttachmentSendState =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "sending"; fileName: string }>
  | Readonly<{
      state: "failed";
      fileName: string;
      file: File;
      kind: "media" | "file";
      ambiguous: boolean;
    }>;

export type MessengerMedia = Readonly<{
  handle: string;
  mimeType: string;
  size: number;
  sourceUrl?: string;
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
