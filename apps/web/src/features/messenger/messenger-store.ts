import type {
  MessengerChat,
  MessengerEvent,
  MessengerMessage
} from "./types.js";

export type MessengerSnapshot = Readonly<{
  chats: readonly MessengerChat[];
  messages: readonly MessengerMessage[];
  selectedChatId?: string;
  connection: "connected" | "reconnecting" | "disconnected";
  authentication: "active" | "reauth_required";
}>;

const MAX_CHATS = 250;
const MAX_CURRENT_MESSAGES = 400;

export class MessengerStore {
  private listeners = new Set<() => void>();
  private snapshot: MessengerSnapshot = {
    chats: [],
    messages: [],
    connection: "disconnected",
    authentication: "active"
  };

  getSnapshot = (): MessengerSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  replaceChats(chats: readonly MessengerChat[]): void {
    this.update({
      ...this.snapshot,
      chats: deduplicateChats(chats).slice(0, MAX_CHATS)
    });
  }

  selectChat(chatId: string): void {
    this.update({
      ...this.snapshot,
      selectedChatId: chatId,
      messages: [],
      chats: this.snapshot.chats.map((chat) =>
        chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
      )
    });
  }

  clearSelection(): void {
    this.update({
      chats: this.snapshot.chats,
      messages: [],
      connection: this.snapshot.connection,
      authentication: this.snapshot.authentication
    });
  }

  replaceCurrentMessages(messages: readonly MessengerMessage[]): void {
    this.update({
      ...this.snapshot,
      messages: deduplicateMessages(messages)
        .sort(compareMessages)
        .slice(-MAX_CURRENT_MESSAGES)
    });
  }

  mergeHistory(messages: readonly MessengerMessage[]): void {
    const merged = deduplicateMessages([
      ...this.snapshot.messages,
      ...messages
    ])
      .sort(compareMessages)
      .slice(-MAX_CURRENT_MESSAGES);
    this.update({ ...this.snapshot, messages: merged });
  }

  applyEvent(event: MessengerEvent): void {
    switch (event.type) {
      case "chats.snapshot":
        this.replaceChats(event.chats);
        return;
      case "chat.upsert":
        this.upsertChat(event.chat);
        return;
      case "message.upsert":
        this.upsertMessage(event.message);
        return;
      case "message.deleted":
        if (event.chatId === this.snapshot.selectedChatId) {
          this.update({
            ...this.snapshot,
            messages: this.snapshot.messages.filter(
              (message) => message.id !== event.messageId
            )
          });
        }
        return;
      case "connection.state":
        this.update({ ...this.snapshot, connection: event.state });
        return;
      case "authentication.state":
        this.update({ ...this.snapshot, authentication: event.state });
        return;
    }
  }

  private upsertChat(chat: MessengerChat): void {
    this.replaceChats([
      chat,
      ...this.snapshot.chats.filter((item) => item.id !== chat.id)
    ]);
  }

  private upsertMessage(message: MessengerMessage): void {
    const chatId = message.chatId;
    if (chatId !== undefined && chatId === this.snapshot.selectedChatId) {
      this.mergeHistory([message]);
      this.update({
        ...this.snapshot,
        chats: this.snapshot.chats.map((chat) =>
          chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
        )
      });
      return;
    }
    if (chatId !== undefined && message.direction === "incoming") {
      this.update({
        ...this.snapshot,
        chats: this.snapshot.chats.map((chat) =>
          chat.id === chatId
            ? { ...chat, unreadCount: Math.min(9_999, chat.unreadCount + 1) }
            : chat
        )
      });
    }
  }

  private update(snapshot: MessengerSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function deduplicateChats(
  chats: readonly MessengerChat[]
): MessengerChat[] {
  const seen = new Set<string>();
  return chats.filter((chat) => {
    if (seen.has(chat.id)) {
      return false;
    }
    seen.add(chat.id);
    return true;
  });
}

function deduplicateMessages(
  messages: readonly MessengerMessage[]
): MessengerMessage[] {
  const byId = new Map<string, MessengerMessage>();
  for (const message of messages) {
    byId.set(message.id, message);
  }
  return [...byId.values()];
}

function compareMessages(
  left: MessengerMessage,
  right: MessengerMessage
): number {
  return timestamp(left.sentAt) - timestamp(right.sentAt) ||
    left.id.localeCompare(right.id);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
