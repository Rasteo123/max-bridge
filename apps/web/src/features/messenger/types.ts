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
  text: string;
  direction: "incoming" | "outgoing";
  sentAt: string;
  senderName?: string;
  status?: "pending" | "sent" | "delivered" | "read" | "failed";
}>;

export type MessengerPane = "list" | "conversation";
