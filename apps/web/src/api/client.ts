import type {
  BotNotificationPreferences,
  MessengerAccountSettings
} from "../features/messenger/SettingsPane.js";
import type {
  MessengerChat,
  MessengerChatAction,
  MessengerSticker,
  ReactionEmoji
} from "../features/messenger/types.js";

export type UserState =
  | "pending"
  | "approved_unbound"
  | "authenticating"
  | "active"
  | "reauth_required"
  | "disabled";

export type MaxLoginState =
  | "method_required"
  | "code_required"
  | "qr_required"
  | "captcha_required"
  | "authenticated"
  | "invalid_code"
  | "qr_expired"
  | "failed";

export type MaxLoginResult = Readonly<{
  state: MaxLoginState;
}>;

export type MessageSendResult =
  | Readonly<{
    state: "confirmed";
    operationId: string;
    messageId?: string;
  }>
  | Readonly<{
    state: "ambiguous";
    operationId: string;
  }>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export class ApiClient {
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch) {
    this.fetcher = fetcher.bind(globalThis);
  }

  async authenticateTelegram(initData: string): Promise<void> {
    await this.request("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData })
    });
  }

  async getMe(): Promise<Readonly<{ state: UserState }>> {
    return this.requestJson("/api/me");
  }

  async getMaxLoginStatus(): Promise<MaxLoginResult> {
    return this.requestJson("/api/max/login/status");
  }

  async submitPhone(phone: string): Promise<MaxLoginResult> {
    return this.requestJson("/api/max/login/phone", {
      method: "POST",
      body: JSON.stringify({ phone })
    });
  }

  async submitCode(code: string): Promise<MaxLoginResult> {
    return this.requestJson("/api/max/login/code", {
      method: "POST",
      body: JSON.stringify({ code })
    });
  }

  async sendCaptchaPointer(
    phase: "down" | "move" | "up",
    x: number,
    y: number
  ): Promise<MaxLoginResult> {
    return this.requestJson("/api/max/login/captcha/pointer", {
      method: "POST",
      body: JSON.stringify({ phase, x, y })
    });
  }

  async logoutMax(): Promise<void> {
    await this.request("/api/max/logout", { method: "POST" });
  }

  async listChats(): Promise<Readonly<{
    chats: readonly MessengerChat[];
  }>> {
    return this.requestJson("/api/chats");
  }

  async searchChats(
    query: string,
    signal?: AbortSignal
  ): Promise<Readonly<{ chats: readonly MessengerChat[] }>> {
    return this.requestJson(
      `/api/chats/search?q=${encodeURIComponent(query)}`,
      signal === undefined ? undefined : { signal }
    );
  }

  async getHistory(
    chatId: string,
    cursor?: string
  ): Promise<Readonly<{ messages: readonly unknown[] }>> {
    const query = cursor === undefined
      ? ""
      : `?cursor=${encodeURIComponent(cursor)}`;
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/messages${query}`
    );
  }

  async getNotificationPreferences(): Promise<BotNotificationPreferences> {
    return this.requestJson("/api/notifications");
  }

  async setNotificationsEnabled(
    enabled: boolean
  ): Promise<BotNotificationPreferences> {
    return this.requestJson("/api/notifications", {
      method: "PUT",
      body: JSON.stringify({ enabled })
    });
  }

  async setChatNotifications(
    chatId: string,
    muted: boolean
  ): Promise<BotNotificationPreferences> {
    return this.requestJson(
      `/api/notifications/chats/${encodeURIComponent(chatId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ muted })
      }
    );
  }

  async getSettings(): Promise<Readonly<{
    settings: MessengerAccountSettings;
  }>> {
    return this.requestJson("/api/settings");
  }

  async subscribeToChat(
    link: string
  ): Promise<Readonly<{ chat: MessengerChat }>> {
    return this.requestJson("/api/chats/subscribe", {
      method: "POST",
      body: JSON.stringify({ link })
    });
  }

  async unsubscribeFromChat(chatId: string): Promise<void> {
    await this.request(
      `/api/chats/${encodeURIComponent(chatId)}/unsubscribe`,
      { method: "POST" }
    );
  }

  async getContact(
    contactId: string
  ): Promise<Readonly<{ contact: MessengerChat }>> {
    return this.requestJson(
      `/api/contacts/${encodeURIComponent(contactId)}`
    );
  }

  async getComments(
    chatId: string,
    messageId: string
  ): Promise<Readonly<{ messages: readonly unknown[] }>> {
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/messages/`
      + `${encodeURIComponent(messageId)}/comments`
    );
  }

  async sendText(
    chatId: string,
    text: string,
    replyToId?: string,
    clientRequestId: string = globalThis.crypto.randomUUID()
  ): Promise<MessageSendResult> {
    return this.requestJson("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        kind: "text",
        chatId,
        clientRequestId,
        text,
        ...(replyToId === undefined ? {} : { replyToId })
      })
    });
  }

  async editMessage(
    chatId: string,
    messageId: string,
    text: string,
    clientRequestId: string = globalThis.crypto.randomUUID()
  ): Promise<MessageSendResult> {
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/messages/` +
      encodeURIComponent(messageId),
      {
        method: "PATCH",
        body: JSON.stringify({ text, clientRequestId })
      }
    );
  }

  async deleteMessage(
    chatId: string,
    messageId: string,
    forEveryone = false,
    clientRequestId: string = globalThis.crypto.randomUUID()
  ): Promise<MessageSendResult> {
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/messages/` +
      `${encodeURIComponent(messageId)}/delete`,
      {
        method: "POST",
        body: JSON.stringify({
          clientRequestId,
          confirmedByUser: true,
          forEveryone
        })
      }
    );
  }

  async forwardMessage(
    sourceChatId: string,
    sourceMessageId: string,
    destinationIds: readonly string[],
    clientRequestId: string = globalThis.crypto.randomUUID()
  ): Promise<MessageSendResult> {
    return this.requestJson(
      `/api/chats/${encodeURIComponent(sourceChatId)}/messages/` +
      `${encodeURIComponent(sourceMessageId)}/forward`,
      {
        method: "POST",
        body: JSON.stringify({
          destinationIds,
          clientRequestId
        })
      }
    );
  }

  async setReaction(
    chatId: string,
    messageId: string,
    reaction: ReactionEmoji | null,
    clientRequestId: string = globalThis.crypto.randomUUID()
  ): Promise<MessageSendResult> {
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/messages/` +
      `${encodeURIComponent(messageId)}/reaction`,
      {
        method: "PUT",
        body: JSON.stringify({ reaction, clientRequestId })
      }
    );
  }

  async chatAction(
    chatId: string,
    action: MessengerChatAction,
    clientRequestId: string = globalThis.crypto.randomUUID()
  ): Promise<MessageSendResult> {
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/actions`,
      {
        method: "POST",
        body: JSON.stringify({
          action,
          clientRequestId,
          ...(action === "clear" || action === "delete"
            ? { confirmedByUser: true }
            : {})
        })
      }
    );
  }

  async listStickers(chatId: string): Promise<Readonly<{
    stickers: readonly MessengerSticker[];
  }>> {
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/stickers`
    );
  }

  async sendSticker(
    chatId: string,
    stickerId: string,
    clientRequestId: string = globalThis.crypto.randomUUID()
  ): Promise<MessageSendResult> {
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/stickers/` +
      encodeURIComponent(stickerId),
      {
        method: "POST",
        body: JSON.stringify({ clientRequestId })
      }
    );
  }

  async sendAttachment(
    chatId: string,
    file: File,
    kind: "media" | "file",
    clientRequestId: string = globalThis.crypto.randomUUID()
  ): Promise<MessageSendResult> {
    const query = new URLSearchParams({
      kind,
      name: file.name,
      clientRequestId
    });
    return this.requestJson(
      `/api/chats/${encodeURIComponent(chatId)}/attachments?${query}`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file
      }
    );
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const response = await this.request(path, init);
    return response.json() as Promise<T>;
  }

  private async request(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    headers.set("accept", "application/json");
    const response = await this.fetcher(path, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers
    });
    if (response.ok) {
      return response;
    }

    let code = "request_failed";
    try {
      const payload = await response.json() as { code?: unknown };
      if (typeof payload.code === "string") {
        code = payload.code;
      }
    } catch {
      // Public errors intentionally contain no sensitive response details.
    }
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfter === null
      ? undefined
      : Number.parseInt(retryAfter, 10);
    throw new ApiError(
      response.status,
      code,
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined
    );
  }
}
