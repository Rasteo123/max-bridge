import type { BotTransport } from "../bot/contracts.js";
import {
  formatPrivateNotification,
  type PrivateNotification
} from "../bot/notifications.js";
import type { NotificationDeduplicator } from "./deduplicator.js";

export type NotificationSettings = Readonly<{
  enabled: boolean;
  mutedChatIds: readonly string[];
  previewChatIds: readonly string[];
}>;

export interface NotificationSettingsGateway {
  load(userLookup: string): Promise<NotificationSettings>;
}

export type NotificationEvent = Readonly<{
  userLookup: string;
  telegramId: string;
  sequence: number;
  messageId: string;
  chatId: string;
  senderName: string;
  kind: PrivateNotification["kind"];
  body?: string;
  mediaUrl?: string;
  /** Whether the chat is muted in MAX itself. */
  chatMuted?: boolean;
}>;

type NotificationRouterOptions = Readonly<{
  transport: BotTransport;
  settings: NotificationSettingsGateway;
  deduplicator: NotificationDeduplicator;
}>;

export class NotificationRouter {
  constructor(private readonly options: NotificationRouterOptions) {}

  async handle(event: NotificationEvent): Promise<void> {
    const settings = await this.options.settings.load(event.userLookup);
    if (
      !this.options.deduplicator.accept(
        event.userLookup,
        event.sequence,
        event.messageId
      )
    ) {
      return;
    }
    // A chat silenced in MAX stays silent here too, on top of whatever the
    // viewer muted for the bot alone.
    if (
      !settings.enabled
      || event.chatMuted === true
      || settings.mutedChatIds.includes(event.chatId)
    ) {
      return;
    }
    const base = formatPrivateNotification({
      senderName: event.senderName,
      kind: event.kind
    });
    const preview = settings.previewChatIds.includes(event.chatId)
      ? boundedPreview(event.body)
      : null;
    await this.options.transport.send({
      chatId: event.telegramId,
      text: preview === null ? base : `${base}\n${preview}`
    });
  }
}

function boundedPreview(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length === 0 ? null : normalized.slice(0, 160);
}
