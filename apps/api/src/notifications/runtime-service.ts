import type {
  BridgeEvent,
  ChatSummary,
  UserRecord
} from "@maxbridge/core";

import type { TelegramIdentity } from "../db/users-repository.js";
import type {
  NotificationEvent,
  NotificationRouter
} from "./router.js";

export interface RuntimeNotificationSource {
  list(userLookup: string): Promise<readonly ChatSummary[]>;
  subscribeAll(
    listener: (userLookup: string, event: BridgeEvent) => void
  ): () => void;
}

export interface RuntimeNotificationUsers {
  listUsersByState(state: "active"): readonly UserRecord[];
  findIdentityByLookup(
    userLookup: string
  ): Promise<TelegramIdentity | null>;
}

type RuntimeNotificationServiceOptions = Readonly<{
  source: RuntimeNotificationSource;
  users: RuntimeNotificationUsers;
  router: Pick<NotificationRouter, "handle">;
  onError?(error: unknown): void;
}>;

export class RuntimeNotificationService {
  private readonly chatTitles = new Map<string, Map<string, string>>();
  private readonly mutedChats = new Map<string, Set<string>>();
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly options: RuntimeNotificationServiceOptions) {}

  async start(): Promise<void> {
    if (this.unsubscribe !== undefined) {
      return;
    }
    this.unsubscribe = this.options.source.subscribeAll(
      (userLookup, event) => {
        this.captureChatTitles(userLookup, event);
        void this.handle(userLookup, event).catch((error: unknown) => {
          this.options.onError?.(error);
        });
      }
    );
    await Promise.all(this.options.users.listUsersByState("active").map(
      async (user) => {
        try {
          const chats = await this.options.source.list(user.lookupId);
          this.rememberChats(user.lookupId, chats);
        } catch (error: unknown) {
          this.options.onError?.(error);
        }
      }
    ));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.chatTitles.clear();
    this.mutedChats.clear();
  }

  private async handle(
    userLookup: string,
    event: BridgeEvent
  ): Promise<void> {
    if (
      event.type !== "message.upsert" ||
      event.message.direction !== "incoming"
    ) {
      return;
    }
    const message = event.message;
    if (message.kind === "system") {
      return;
    }
    const identity = await this.options.users.findIdentityByLookup(userLookup);
    if (identity === null) {
      return;
    }
    const notification: NotificationEvent = {
      userLookup,
      telegramId: identity.telegramId,
      sequence: event.sequence,
      messageId: message.id,
      chatId: message.chatId,
      senderName: message.senderName ??
        this.chatTitles.get(userLookup)?.get(message.chatId) ??
        "контакта в MAX",
      kind: message.kind,
      ...(this.mutedChats.get(userLookup)?.has(message.chatId) === true
        ? { chatMuted: true }
        : {}),
      ...("text" in message
        ? { body: message.text }
        : {})
    };
    await this.options.router.handle(notification);
  }

  private captureChatTitles(
    userLookup: string,
    event: BridgeEvent
  ): void {
    if (event.type === "chats.snapshot") {
      this.rememberChats(userLookup, event.chats);
      return;
    }
    if (event.type === "chat.upsert") {
      const titles = this.chatTitles.get(userLookup) ??
        new Map<string, string>();
      titles.set(event.chat.id, event.chat.title);
      this.chatTitles.set(userLookup, titles);
      const muted = this.mutedChats.get(userLookup) ?? new Set<string>();
      if (event.chat.muted) {
        muted.add(event.chat.id);
      } else {
        muted.delete(event.chat.id);
      }
      this.mutedChats.set(userLookup, muted);
    }
  }

  private rememberChats(
    userLookup: string,
    chats: readonly ChatSummary[]
  ): void {
    this.chatTitles.set(
      userLookup,
      new Map(chats.map((chat) => [chat.id, chat.title]))
    );
    this.mutedChats.set(
      userLookup,
      new Set(chats.filter((chat) => chat.muted).map((chat) => chat.id))
    );
  }
}
