import type {
  MessengerChat,
  MessengerEvent,
  MessengerForwardedSource,
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
  private presenceInvalidated = false;
  private transientChats = new Map<string, MessengerChat>();
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
    const chatIds = new Set(chats.map((chat) => chat.id));
    const normalized = deduplicateChats([
      ...chats,
      ...[...this.transientChats.values()].filter(
        (chat) => !chatIds.has(chat.id)
      )
    ]).slice(0, MAX_CHATS);
    this.update({
      ...this.snapshot,
      chats: this.presenceInvalidated
        ? invalidatePresence(normalized)
        : normalized
    });
  }

  addTransientChat(source: MessengerForwardedSource): void {
    if (this.snapshot.chats.some((chat) => chat.id === source.chatId)) {
      return;
    }
    const chat: MessengerChat = {
      id: source.chatId,
      title: source.title,
      preview: "",
      timestamp: new Date(0).toISOString(),
      unreadCount: 0,
      muted: false,
      kind: source.kind,
      // Nothing forwarded is known to be joined until MAX says so.
      joined: false
    };
    this.transientChats.set(chat.id, chat);
    this.update({
      ...this.snapshot,
      chats: [chat, ...this.snapshot.chats].slice(0, MAX_CHATS)
    });
  }

  /**
   * Replaces a placeholder built from a forward with what MAX actually knows
   * about the chat. A chat the viewer has since joined stays where the real
   * list put it and is left alone.
   */
  describeTransientChat(chat: MessengerChat): void {
    if (!this.transientChats.has(chat.id)) {
      return;
    }
    const merged: MessengerChat = {
      ...chat,
      timestamp: this.transientChats.get(chat.id)?.timestamp ?? chat.timestamp
    };
    this.transientChats.set(chat.id, merged);
    this.update({
      ...this.snapshot,
      chats: this.snapshot.chats.map((entry) =>
        entry.id === chat.id ? merged : entry
      )
    });
  }

  removeTransientChat(chatId: string): void {
    if (!this.transientChats.delete(chatId)) {
      return;
    }
    this.update({
      ...this.snapshot,
      chats: this.snapshot.chats.filter((chat) => chat.id !== chatId),
      ...(this.snapshot.selectedChatId === chatId
        ? { messages: [] }
        : {})
    });
  }

  selectChat(chatId: string): void {
    const dropped = this.forgetUnvisitedTransients(chatId);
    this.update({
      ...this.snapshot,
      selectedChatId: chatId,
      messages: [],
      chats: this.snapshot.chats
        .filter((chat) => !dropped.has(chat.id))
        .map((chat) =>
          chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
        )
    });
  }

  /**
   * A chat opened from a forward is only borrowed: the viewer never joined it,
   * so it belongs in the list exactly as long as they are looking at it. One
   * they did join comes back through the real chat list and is not transient.
   */
  private forgetUnvisitedTransients(keptChatId?: string): ReadonlySet<string> {
    const dropped = new Set<string>();
    for (const chatId of this.transientChats.keys()) {
      if (chatId !== keptChatId) {
        dropped.add(chatId);
      }
    }
    for (const chatId of dropped) {
      this.transientChats.delete(chatId);
    }
    return dropped;
  }

  clearSelection(): void {
    const dropped = this.forgetUnvisitedTransients();
    this.update({
      chats: this.snapshot.chats.filter((chat) => !dropped.has(chat.id)),
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
        this.presenceInvalidated = event.state !== "connected";
        this.update({
          ...this.snapshot,
          connection: event.state,
          chats: this.presenceInvalidated
            ? invalidatePresence(this.snapshot.chats)
            : this.snapshot.chats
        });
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

function invalidatePresence(
  chats: readonly MessengerChat[]
): readonly MessengerChat[] {
  return chats.map((chat) => {
    if (
      chat.kind !== "direct" ||
      chat.presence === undefined && chat.lastSeenAt === undefined
    ) {
      return chat;
    }
    const sanitized: MessengerChat & { lastSeenAt?: number } = {
      ...chat,
      presence: "unknown"
    };
    Reflect.deleteProperty(sanitized, "lastSeenAt");
    return sanitized;
  });
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
