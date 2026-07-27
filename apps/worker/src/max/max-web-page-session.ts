import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type {
  BridgeEvent,
  ChatSummary,
  Message
} from "@maxbridge/core";
import {
  MaxLoginController,
  MaxSession,
  captchaElement,
  decodeMaxFrame,
  discoverMaxClientBindings,
  type MaxClientBindings,
  type MaxLoginResult
} from "@maxbridge/max-adapter";
import type {
  BrowserContext,
  Locator,
  Page,
  Response,
  WebSocket
} from "playwright";
import {
  instrumentMaxNodeModule,
  MAX_SESSION_ACCESSOR_KEY
} from "./max-node-instrumentation.js";
import type { CaptchaPointerInput } from "../runtime/request-handler.js";

const MAX_WEB_URL = "https://web.max.ru/";
const MAX_NODE_MODULE_PATTERN = "/_app/immutable/nodes/0.";
const MAX_HISTORY_WAIT_MS = 10_000;
const MAX_HISTORY_POLL_MS = 150;
const MAX_HISTORY_MIN_SETTLE_MS = 1_200;
const MAX_HISTORY_SINGLE_MESSAGE_SETTLE_MS = 4_000;
const MAX_SEND_CONFIRMATION_MS = 10_000;
const MAX_SESSION_READY_WAIT_MS = 15_000;
const MAX_ACTION_WAIT_MS = 7_500;
const MAX_STICKERS_PER_LIST = 12;
const MAX_STICKER_PREVIEW_DATA_URL_BYTES = 40 * 1024;
const MAX_MEDIA_ROOT = "/run/maxbridge/media";
const MAX_COMPOSER_SELECTOR = [
  '[contenteditable]:not([contenteditable="false"])[role="textbox"]',
  "textarea"
].join(", ");

const MAX_REACTION_ORDER = [
  "like",
  "heart",
  "laugh",
  "fire",
  "cry",
  "celebrate"
] as const;

type MaxReactionKey = typeof MAX_REACTION_ORDER[number];
type MaxChatAction =
  | "pin"
  | "unpin"
  | "mark_unread"
  | "mute"
  | "unmute"
  | "clear"
  | "delete";

type PendingSend = {
  resolve: (messageId?: string) => void;
  timeout: NodeJS.Timeout;
};

export class MaxWebPageSession {
  private bindings: MaxClientBindings | undefined;
  private adapter: MaxSession | undefined;
  private readonly login: MaxLoginController;
  private pendingSend: PendingSend | undefined;
  private captchaPointerDown = false;
  private stopped = false;

  constructor(private readonly options: Readonly<{
    page: Page;
    context: BrowserContext;
    onEvents?: (events: readonly BridgeEvent[]) => void;
  }>) {
    this.login = new MaxLoginController(options.page, {
      isNetworkAuthenticated: async () => this.isAuthenticated()
    });
    options.page.on("websocket", (socket) => {
      this.observeSocket(socket);
    });
  }

  async start(): Promise<MaxLoginResult> {
    await this.options.page.route(
      "**/_app/immutable/nodes/0.*.js",
      async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        await route.fulfill({
          response,
          body: instrumentMaxNodeModule(source)
        });
      }
    );
    await this.options.page.goto(MAX_WEB_URL, {
      waitUntil: "domcontentloaded"
    });
    await this.ensureBindings();
    const deadline = Date.now() + 10_000;
    let state = await this.login.detectState();
    while (state.state === "failed" && Date.now() <= deadline) {
      await this.options.page.waitForTimeout(50);
      state = await this.login.detectState();
    }
    if (state.state === "authenticated") {
      await this.ensureAdapter();
    }
    return state;
  }

  async background(): Promise<void> {
    this.adapter?.leaveChat();
    if (this.options.page.url() === MAX_WEB_URL) {
      return;
    }
    this.bindings = undefined;
    await this.options.page.goto(MAX_WEB_URL, {
      waitUntil: "domcontentloaded"
    });
    await this.ensureBindings();
  }

  async submitPhone(phone: string): Promise<MaxLoginResult> {
    const exchanges = new Map<string, number>();
    const observeResponse = (response: Response) => {
      const method = response.request().method();
      if (method === "GET" || method === "OPTIONS") {
        return;
      }
      try {
        const origin = new URL(response.url()).origin;
        exchanges.set(
          `${method} ${origin} ${String(response.status())}`,
          (exchanges.get(
            `${method} ${origin} ${String(response.status())}`
          ) ?? 0) + 1
        );
      } catch {
        // Ignore malformed URLs from browser extensions or internal schemes.
      }
    };
    this.options.page.on("response", observeResponse);
    try {
      const result = await this.login.submitPhone(phone);
      if (result.state === "failed") {
        const diagnostic = {
          event: "max_login_phone_failed",
          alertCategory: await this.login.failureCategory(),
          exchanges: [...exchanges.entries()].map(([exchange, count]) => ({
            exchange,
            count
          }))
        };
        process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
      }
      return result;
    } finally {
      this.options.page.off("response", observeResponse);
    }
  }

  async submitCode(code: string): Promise<Readonly<{
    result: MaxLoginResult;
    storageStateBase64?: string;
  }>> {
    const result = await this.login.submitCode(code);
    if (result.state !== "authenticated") {
      return { result };
    }
    // SMS login can replace the MAX application tree. Re-discover the
    // minified client exports instead of retaining bindings from the login UI.
    this.bindings = undefined;
    await this.ensureAdapter();
    const state = await this.options.context.storageState({
      indexedDB: true
    });
    const encoded = Buffer.from(JSON.stringify(state), "utf8");
    try {
      return {
        result,
        storageStateBase64: encoded.toString("base64")
      };
    } finally {
      encoded.fill(0);
    }
  }

  getQrPng(): Promise<Buffer> {
    return this.login.getQrPng();
  }

  async getCaptchaPng(): Promise<Buffer> {
    const captcha = captchaElement(this.options.page);
    if (!(await captcha.isVisible().catch(() => false))) {
      throw new Error("MAX CAPTCHA is unavailable");
    }
    return captcha.screenshot({
      animations: "disabled",
      type: "png"
    });
  }

  async sendCaptchaPointer(
    input: CaptchaPointerInput
  ): Promise<MaxLoginResult> {
    const captcha = captchaElement(this.options.page);
    const box = await captcha.boundingBox().catch(() => null);

    if (box === null) {
      if (input.phase === "up" && this.captchaPointerDown) {
        await this.options.page.mouse.up({ button: "left" });
        this.captchaPointerDown = false;
        return this.login.detectState();
      }
      throw new Error("MAX CAPTCHA is unavailable");
    }
    if (box.width < 1 || box.height < 1) {
      throw new Error("MAX CAPTCHA has invalid bounds");
    }

    const x = box.x + (
      box.width * Math.min(input.x, 0.999_999)
    );
    const y = box.y + (
      box.height * Math.min(input.y, 0.999_999)
    );
    if (input.phase === "down") {
      if (this.captchaPointerDown) {
        await this.options.page.mouse.up({ button: "left" });
      }
      await this.options.page.mouse.move(x, y);
      await this.options.page.mouse.down({ button: "left" });
      this.captchaPointerDown = true;
    } else if (input.phase === "move") {
      if (!this.captchaPointerDown) {
        throw new Error("MAX CAPTCHA pointer is not active");
      }
      await this.options.page.mouse.move(x, y);
    } else {
      if (!this.captchaPointerDown) {
        throw new Error("MAX CAPTCHA pointer is not active");
      }
      await this.options.page.mouse.move(x, y);
      await this.options.page.mouse.up({ button: "left" });
      this.captchaPointerDown = false;
    }

    return this.login.detectState();
  }

  async status(): Promise<MaxLoginResult> {
    const result = await this.login.detectState();
    if (result.state === "authenticated") {
      await this.ensureAdapter();
    }
    return result;
  }

  async listChats(): Promise<readonly ChatSummary[]> {
    const adapter = await this.ensureAdapter();
    const snapshot = await this.options.page.evaluate(
      (accessorKey) => {
        const accessorValue = (
          globalThis as Record<PropertyKey, unknown>
        )[Symbol.for(accessorKey)];
        if (typeof accessorValue !== "function") {
          throw new Error("binding");
        }
        const accessor = accessorValue as () => {
          viewer?: {
            id?: unknown;
            folders?: {
              all?: { chats?: unknown };
              visible?: unknown;
            };
          };
        };
        const session = accessor();
        const chats = session.viewer?.folders?.all?.chats;
        const values = iterableValues(chats);
        const viewerId = opaque(session.viewer?.id);
        const avatarByTitle = new Map<string, string>();
        for (const row of document.querySelectorAll("button.cell")) {
          const title = row.querySelector("h3")?.textContent.trim();
          const source = row.querySelector("img")?.getAttribute("src");
          if (
            title !== undefined &&
            title.length > 0 &&
            source !== null &&
            source !== undefined &&
            isAllowedAvatar(source)
          ) {
            avatarByTitle.set(title, source);
          }
        }
        return {
          viewerId,
          chats: values.slice(0, 1_000).map((value) => {
            const tuple = Array.isArray(value)
              ? value as unknown[]
              : undefined;
            const mapValue = tuple?.length === 2
              && record(tuple[1]) !== undefined
              ? tuple[1]
              : value;
            const chat = mapValue as Record<string, unknown>;
            const raw = record(chat["$"]);
            const last = record(chat["lastMessage"] ?? raw?.["lastMessage"]);
            const rawLast = record(last?.["$"]);
            const recipient = record(
              chat["recipient"] ?? raw?.["recipient"]
            );
            const rawRecipient = record(recipient?.["$"]);
            const presence = record(recipient?.["presence"]);
            const rawPresence = record(presence?.["$"]);
            const presenceStatus = strictPresenceStatus(presence?.["status"]);
            const presenceIsOnline = strictBoolean(presence?.["isOnline"]);
            const presenceSeen = strictEpochInteger(
              presence?.["seen"],
              946_684_800_000,
              4_102_444_800_000
            );
            const rawPresenceSeen = strictEpochInteger(
              rawPresence?.["seen"],
              946_684_800,
              4_102_444_800
            );
            const online = strictBoolean(recipient?.["online"])
              ?? strictBoolean(recipient?.["isOnline"])
              ?? strictBoolean(rawRecipient?.["online"])
              ?? strictBoolean(rawRecipient?.["isOnline"]);
            const lastMessageSenderId = optionalOpaque(last?.["sender"])
              ?? optionalOpaque(last?.["senderId"])
              ?? optionalOpaque(last?.["authorId"])
              ?? optionalOpaque(rawLast?.["sender"])
              ?? optionalOpaque(rawLast?.["senderId"])
              ?? optionalOpaque(rawLast?.["authorId"]);
            const lastMessageStatus = aliasedText(
              last,
              rawLast,
              ["status", "deliveryStatus", "ack"]
            );
            const id = chatOpaque(
              chat["id"] ?? raw?.["id"] ?? tuple?.[0]
            );
            const storedTitle = richText(
              chat["longName"] ?? raw?.["longName"]
            );
            const isSaved = id === "0" || id === viewerId;
            const title = isSaved
              ? "Избранное"
              : storedTitle ?? "Чат";
            return {
              id,
              viewerId,
              type: isSaved
                ? "SAVED"
                : text(raw?.["type"])
                ?? (recipient === undefined ? "CHAT" : "DIALOG"),
              title,
              avatarUrl: avatarByTitle.get(title),
              ...(
                presenceStatus === undefined
                && presenceIsOnline === undefined
                && presenceSeen === undefined
                && rawPresenceSeen === undefined
                && online === undefined
                  ? {}
                  : {
                    recipient: {
                      ...(presenceStatus === undefined
                        && presenceIsOnline === undefined
                        && presenceSeen === undefined
                        && rawPresenceSeen === undefined
                        ? {}
                        : {
                          presence: {
                            ...(presenceStatus === undefined
                              ? {}
                              : { status: presenceStatus }),
                            ...(presenceIsOnline === undefined
                              ? {}
                              : { isOnline: presenceIsOnline }),
                            ...(presenceSeen === undefined
                              ? {}
                              : { seen: presenceSeen }),
                            ...(rawPresenceSeen === undefined
                              ? {}
                              : { $: { seen: rawPresenceSeen } })
                          }
                        }),
                      ...(online === undefined ? {} : { online })
                    }
                  }
              ),
              lastMessage: last === undefined
                ? undefined
                : {
                    id: opaque(last["id"] ?? rawLast?.["id"]),
                    ...(lastMessageSenderId === undefined
                      ? {}
                      : { senderId: lastMessageSenderId }),
                    ...(lastMessageStatus === undefined
                      ? {}
                      : { status: lastMessageStatus }),
                    time: temporal(last["time"] ?? rawLast?.["time"]),
                    text: richText(last["text"] ?? rawLast?.["text"]),
                    attaches: attachments(
                      last["attaches"] ?? rawLast?.["attaches"]
                    )
                  },
              lastMessageTime: temporal(
                last?.["time"]
                ?? rawLast?.["time"]
                ?? chat["sortTime"]
                ?? chat["lastEventTime"]
              ),
              unreadCount: integer(
                chat["newMessages"] ?? raw?.["newMessages"]
              ),
              muted: Boolean(chat["muted"] ?? raw?.["muted"] ?? false),
              pinned: Boolean(
                chat["pinned"]
                ?? raw?.["pinned"]
                ?? chat["isPinned"]
                ?? raw?.["isPinned"]
                ?? false
              )
            };
          }).filter((chat) => chat.id.length > 0)
        };

        function iterableValues(value: unknown): unknown[] {
          if (Array.isArray(value)) {
            return value;
          }
          if (
            value !== null
            && typeof value === "object"
            && Symbol.iterator in value
          ) {
            return Array.from(value as Iterable<unknown>);
          }
          return [];
        }
        function record(value: unknown): Record<string, unknown> | undefined {
          return value !== null && typeof value === "object"
            ? value as Record<string, unknown>
            : undefined;
        }
        function opaque(value: unknown): string {
          if (typeof value === "bigint" || typeof value === "number") {
            return String(value);
          }
          return typeof value === "string" ? value : "0";
        }
        function chatOpaque(value: unknown): string {
          if (typeof value === "bigint" || typeof value === "number") {
            return String(value);
          }
          return typeof value === "string" ? value : "";
        }
        function optionalOpaque(value: unknown): string | undefined {
          if (typeof value === "bigint" || typeof value === "number") {
            return String(value);
          }
          return typeof value === "string" ? value : undefined;
        }
        function text(value: unknown): string | undefined {
          return typeof value === "string" ? value : undefined;
        }
        function aliasedText(
          primary: Record<string, unknown> | undefined,
          raw: Record<string, unknown> | undefined,
          aliases: readonly string[]
        ): string | undefined {
          for (const alias of aliases) {
            const value = text(safeValue(primary, alias));
            if (value !== undefined) {
              return value;
            }
          }
          for (const alias of aliases) {
            const value = text(safeValue(raw, alias));
            if (value !== undefined) {
              return value;
            }
          }
          return undefined;
        }
        function strictBoolean(value: unknown): boolean | undefined {
          return typeof value === "boolean" ? value : undefined;
        }
        function strictPresenceStatus(
          value: unknown
        ): 0 | 1 | 2 | 3 | undefined {
          return value === 0 || value === 1 || value === 2 || value === 3
            ? value
            : undefined;
        }
        function strictEpochInteger(
          value: unknown,
          minimum: number,
          maximum: number
        ): number | undefined {
          return (
            typeof value === "number"
            && Number.isSafeInteger(value)
            && value >= minimum
            && value <= maximum
          )
            ? value
            : undefined;
        }
        function isAllowedAvatar(value: string): boolean {
          try {
            const url = new URL(value);
            return url.protocol === "https:" && url.hostname === "i.oneme.ru";
          } catch {
            return false;
          }
        }
        function richText(value: unknown): string | undefined {
          if (typeof value === "string") {
            return value;
          }
          return text(record(value)?.["plain"]);
        }
        function temporal(value: unknown): number | string {
          return typeof value === "bigint"
            ? value.toString()
            : typeof value === "number" || typeof value === "string"
              ? value
              : Date.now();
        }
        function integer(value: unknown): number {
          return typeof value === "number" && Number.isFinite(value)
            ? Math.max(0, Math.trunc(value))
            : 0;
        }
        function attachments(value: unknown): unknown[] {
          const direct = arrayItems(value, 8);
          const container = direct === undefined ? record(value) : undefined;
          const rawContainer = record(safeValue(container, "$"));
          const source = direct
            ?? arrayItems(safeValue(container, "attaches"), 8)
            ?? arrayItems(safeValue(rawContainer, "attaches"), 8)
            ?? arrayItems(rawContainer, 8);
          if (source === undefined) {
            return [];
          }
          return source.flatMap((entry) => {
            const projected = projectAttachment(entry);
            return projected === undefined ? [] : [projected];
          });
        }
        function projectAttachment(
          value: unknown
        ): Record<string, string | number> | undefined {
          const tuple = arrayItems(value, 2);
          const tupleValue = tuple?.length === 2
            ? tuple[1]
            : value;
          const attachment = record(tupleValue);
          if (attachment === undefined) {
            return undefined;
          }
          const raw = record(safeValue(attachment, "$"));
          const projected: Record<string, string | number> = {};
          let fields = 0;
          for (const field of ["_type", "type", "kind"]) {
            const selected = boundedString(
              safeValue(attachment, field),
              64
            ) ?? boundedString(safeValue(raw, field), 64);
            if (selected !== undefined) {
              projected[field] = selected;
              fields += 1;
            }
          }
          return fields === 0 ? undefined : projected;
        }
        function safeValue(
          value: Record<string, unknown> | undefined,
          key: string
        ): unknown {
          try {
            return value?.[key];
          } catch {
            return undefined;
          }
        }
        function arrayItems(
          value: unknown,
          maximum: number
        ): unknown[] | undefined {
          try {
            if (!Array.isArray(value)) {
              return undefined;
            }
            const length = Math.min(value.length, maximum);
            const output: unknown[] = [];
            for (let index = 0; index < length; index += 1) {
              try {
                output.push(value[index]);
              } catch {
                // Skip hostile entries without enumerating the source.
              }
            }
            return output;
          } catch {
            return undefined;
          }
        }
        function boundedString(
          value: unknown,
          maximum: number
        ): string | undefined {
          return typeof value === "string"
            ? value.slice(0, maximum)
            : undefined;
        }
      },
      MAX_SESSION_ACCESSOR_KEY
    );
    if (snapshot.viewerId !== "0") {
      this.ensureViewer(snapshot.viewerId);
    }
    adapter.replaceChats({ chats: snapshot.chats });
    return adapter.chats;
  }

  async history(chatId: string): Promise<readonly Message[] | null> {
    const adapter = await this.ensureAdapter();
    const chats = await this.listChats();
    if (!chats.some((chat) => chat.id === chatId)) {
      return null;
    }
    const before = await this.readMessages(chatId);
    const currentChatId = chatIdFromPageUrl(this.options.page.url());
    const alternate = chats.find((chat) => chat.id !== chatId);
    if (
      currentChatId === chatId
      && before.length <= 1
      && alternate !== undefined
    ) {
      await this.activateChat(alternate.id);
    }
    await this.activateChat(chatId);

    const startedAt = Date.now();
    const deadline = Date.now() + MAX_HISTORY_WAIT_MS;
    let messages: unknown[] = before;
    let previousFingerprint = "";
    let stableReads = 0;
    while (Date.now() <= deadline) {
      await this.options.page.waitForTimeout(MAX_HISTORY_POLL_MS);
      messages = await this.readMessages(chatId);
      const fingerprint = historyFingerprint(messages);
      if (fingerprint === previousFingerprint) {
        stableReads += 1;
      } else {
        previousFingerprint = fingerprint;
        stableReads = 0;
      }
      const elapsed = Date.now() - startedAt;
      const minimum = messages.length <= 1
        ? MAX_HISTORY_SINGLE_MESSAGE_SETTLE_MS
        : MAX_HISTORY_MIN_SETTLE_MS;
      if (elapsed >= minimum && stableReads >= 3) {
        break;
      }
    }
    adapter.openChat(chatId);
    adapter.replaceOpenHistory({ messages });
    return adapter.openMessages;
  }

  async sendText(
    chatId: string,
    textValue: string,
    replyToId?: string
  ): Promise<Readonly<{
    state: "confirmed" | "ambiguous";
    operationId: string;
    messageId?: string;
  }>> {
    if (textValue.length < 1 || textValue.length > 65_536) {
      throw new TypeError("Message is invalid");
    }
    if (await this.history(chatId) === null) {
      throw new TypeError("Chat is unavailable");
    }
    if (replyToId !== undefined) {
      const dialog = await this.openMessageMenu(chatId, replyToId);
      await this.clickMenuItem(dialog, "Ответить");
    }
    const operationId = createOperationId();
    const confirmation = new Promise<string | undefined>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSend = undefined;
        resolve(undefined);
      }, MAX_SEND_CONFIRMATION_MS);
      this.pendingSend = { resolve, timeout };
    });

    try {
      const editor = this.options.page
        .locator(MAX_COMPOSER_SELECTOR)
        .last();
      await editor.waitFor({ state: "visible", timeout: 5_000 });
      await editor.fill(textValue);
      await editor.press("Enter");
    } catch {
      this.clearPendingSend();
      throw new Error("MAX send failed before confirmation");
    }

    const messageId = await confirmation;
    return messageId === undefined
      ? { state: "ambiguous", operationId }
      : { state: "confirmed", operationId, messageId };
  }

  async editMessage(
    chatId: string,
    messageId: string,
    textValue: string
  ): Promise<Readonly<{
    state: "confirmed" | "ambiguous";
    operationId: string;
  }>> {
    if (textValue.length < 1 || textValue.length > 65_536) {
      throw new TypeError("Message is invalid");
    }
    if (await this.history(chatId) === null) {
      throw new TypeError("Chat is unavailable");
    }
    const dialog = await this.openMessageMenu(chatId, messageId);
    await this.clickMenuItem(dialog, "Редактировать");
    const editor = this.options.page.locator(MAX_COMPOSER_SELECTOR).last();
    await editor.waitFor({ state: "visible", timeout: MAX_ACTION_WAIT_MS });
    await editor.fill(textValue);
    await editor.press("Enter");
    const confirmed = await this.waitForMessage(
      chatId,
      messageId,
      (message) => message["text"] === textValue
    );
    return {
      state: confirmed ? "confirmed" : "ambiguous",
      operationId: createOperationId()
    };
  }

  async deleteMessage(
    chatId: string,
    messageId: string
  ): Promise<Readonly<{
    state: "confirmed" | "ambiguous";
    operationId: string;
  }>> {
    if (await this.history(chatId) === null) {
      throw new TypeError("Chat is unavailable");
    }
    const dialog = await this.openMessageMenu(chatId, messageId);
    await this.clickMenuItem(dialog, "Удалить");
    await this.confirmDestructiveAction(["Удалить", "Удалить у всех"]);
    const confirmed = await this.waitForMessage(
      chatId,
      messageId,
      (message) => message["deleted"] === true,
      true
    );
    return {
      state: confirmed ? "confirmed" : "ambiguous",
      operationId: createOperationId()
    };
  }

  async setReaction(
    chatId: string,
    messageId: string,
    reaction: MaxReactionKey | null
  ): Promise<Readonly<{
    state: "confirmed" | "ambiguous";
    operationId: string;
  }>> {
    if (await this.history(chatId) === null) {
      throw new TypeError("Chat is unavailable");
    }
    const dialog = await this.openMessageMenu(chatId, messageId);
    const reactionButtons = dialog.locator("button.reaction");
    const count = await reactionButtons.count();
    if (count < 1) {
      throw new Error("MAX reactions are unavailable");
    }
    const current = await this.readSelectedReaction(chatId, messageId);
    const requested = reaction ?? current;
    if (requested === undefined) {
      await dialog.press("Escape");
      return {
        state: "confirmed",
        operationId: createOperationId()
      };
    }
    const index = MAX_REACTION_ORDER.indexOf(requested);
    if (index < 0 || index >= count) {
      await dialog.press("Escape");
      throw new TypeError("Reaction is unsupported");
    }
    await reactionButtons.nth(index).click({ timeout: MAX_ACTION_WAIT_MS });
    const expected = reaction === null ? undefined : reaction;
    const confirmed = await this.waitForSelectedReaction(
      chatId,
      messageId,
      expected
    );
    return {
      state: confirmed ? "confirmed" : "ambiguous",
      operationId: createOperationId()
    };
  }

  async chatAction(
    chatId: string,
    action: MaxChatAction
  ): Promise<Readonly<{
    state: "confirmed" | "ambiguous";
    operationId: string;
  }>> {
    const chats = await this.listChats();
    const chat = chats.find((candidate) => candidate.id === chatId);
    if (chat === undefined) {
      throw new TypeError("Chat is unavailable");
    }
    const labels: Record<MaxChatAction, readonly string[]> = {
      pin: ["Закрепить"],
      unpin: ["Открепить"],
      mark_unread: ["Отметить непрочитанным"],
      mute: ["Отключить уведомления"],
      unmute: ["Включить уведомления"],
      clear: ["Стереть переписку"],
      delete: ["Удалить чат"]
    };
    try {
      const dialog = await this.openChatMenu(chatId, chat.title);
      await this.clickFirstMenuItem(dialog, labels[action]);
      if (action === "clear") {
        await this.confirmDestructiveAction(["Стереть", "Очистить"]);
      } else if (action === "delete") {
        await this.confirmDestructiveAction(["Удалить"]);
      }
    } finally {
      const search = this.options.page.getByRole("textbox", {
        name: "Найти",
        exact: true
      });
      if (await search.count() === 1) {
        await search.fill("").catch(() => undefined);
      }
    }
    return {
      state: "confirmed",
      operationId: createOperationId()
    };
  }

  async listStickers(chatId: string): Promise<readonly Readonly<{
    id: string;
    previewDataUrl: string;
  }>[]> {
    if (await this.history(chatId) === null) {
      throw new TypeError("Chat is unavailable");
    }
    const dialog = await this.openStickerPanel();
    try {
      const stickers = dialog.locator(
        'button.sticker[data-testid^="sticker-"]'
      );
      await stickers.first().waitFor({
        state: "visible",
        timeout: MAX_ACTION_WAIT_MS
      });
      const count = Math.min(await stickers.count(), MAX_STICKERS_PER_LIST);
      const output: Array<{ id: string; previewDataUrl: string }> = [];
      for (let index = 0; index < count; index += 1) {
        const sticker = stickers.nth(index);
        const testId = await sticker.getAttribute("data-testid");
        const id = testId?.startsWith("sticker-")
          ? testId.slice("sticker-".length)
          : undefined;
        if (id === undefined || !/^[A-Za-z0-9_-]{1,128}$/u.test(id)) {
          continue;
        }
        const canvas = sticker.locator("canvas");
        if (await canvas.count() !== 1) {
          continue;
        }
        const previewDataUrl = await canvas.evaluate((element) => {
          if (!(element instanceof HTMLCanvasElement)) {
            return "";
          }
          return element.toDataURL("image/webp", 0.78);
        });
        if (
          !previewDataUrl.startsWith("data:image/") ||
          Buffer.byteLength(previewDataUrl, "utf8") >
            MAX_STICKER_PREVIEW_DATA_URL_BYTES
        ) {
          continue;
        }
        output.push({
          id,
          previewDataUrl
        });
      }
      return output;
    } finally {
      await dialog.press("Escape").catch(() => undefined);
    }
  }

  async sendSticker(
    chatId: string,
    stickerId: string
  ): Promise<Readonly<{
    state: "confirmed" | "ambiguous";
    operationId: string;
    messageId?: string;
  }>> {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(stickerId)) {
      throw new TypeError("Sticker is invalid");
    }
    if (await this.history(chatId) === null) {
      throw new TypeError("Chat is unavailable");
    }
    const dialog = await this.openStickerPanel();
    const sticker = dialog.getByTestId(`sticker-${stickerId}`);
    if (await sticker.count() !== 1) {
      await dialog.press("Escape").catch(() => undefined);
      throw new TypeError("Sticker is unavailable");
    }
    const operationId = createOperationId();
    const confirmation = new Promise<string | undefined>((resolvePending) => {
      const timeout = setTimeout(() => {
        this.pendingSend = undefined;
        resolvePending(undefined);
      }, MAX_SEND_CONFIRMATION_MS);
      this.pendingSend = { resolve: resolvePending, timeout };
    });
    try {
      await sticker.click({ timeout: MAX_ACTION_WAIT_MS });
    } catch (error: unknown) {
      this.clearPendingSend();
      throw new Error("MAX sticker send failed before confirmation", {
        cause: error
      });
    }
    const messageId = await confirmation;
    return messageId === undefined
      ? { state: "ambiguous", operationId }
      : { state: "confirmed", operationId, messageId };
  }

  async sendAttachment(input: Readonly<{
    chatId: string;
    filePath: string;
    kind: "media" | "file";
  }>): Promise<Readonly<{
    state: "confirmed" | "ambiguous";
    operationId: string;
    messageId?: string;
  }>> {
    const filePath = await validateTransientFile(input.filePath);
    if (await this.history(input.chatId) === null) {
      throw new TypeError("Chat is unavailable");
    }
    const operationId = createOperationId();
    const confirmation = new Promise<string | undefined>((resolvePending) => {
      const timeout = setTimeout(() => {
        this.pendingSend = undefined;
        resolvePending(undefined);
      }, MAX_SEND_CONFIRMATION_MS);
      this.pendingSend = { resolve: resolvePending, timeout };
    });

    let stage = "prepare";
    try {
      const staleDrafts = this.options.page.locator(
        'button:has(use[href="#icon_cross_round_fill_mini_color"])'
      );
      for (
        let draftIndex = 0;
        draftIndex < 8 && await staleDrafts.count() > 0;
        draftIndex += 1
      ) {
        await staleDrafts.first().click({ timeout: 2_000 });
      }
      stage = "set_file";
      const fileInput = this.options.page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: "attached", timeout: 5_000 });
      await fileInput.setInputFiles(filePath);
      stage = "wait_for_preview";
      await this.options.page.waitForFunction(() =>
        Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
          .some((button) =>
            button.getAttribute("aria-label") === "Отправить сообщение"
            && !button.disabled
          ),
      undefined, { timeout: 10_000 });
      stage = "send";
      const send = this.options.page
        .getByRole("button", { name: "Отправить сообщение", exact: true });
      await send.waitFor({ state: "visible", timeout: 10_000 });
      await send.click({ timeout: 10_000 });
    } catch (error: unknown) {
      this.clearPendingSend();
      process.stderr.write(`${JSON.stringify({
        event: "max_attachment_ui_failed",
        stage,
        errorName: error instanceof Error ? error.name : "unknown"
      })}\n`);
      throw new Error("MAX attachment send failed before confirmation", {
        cause: error
      });
    }

    const messageId = await confirmation;
    return messageId === undefined
      ? { state: "ambiguous", operationId }
      : { state: "confirmed", operationId, messageId };
  }

  private async openMessageMenu(
    chatId: string,
    messageId: string
  ): Promise<Locator> {
    await this.dismissOpenDialog();
    const messages = await this.readMessages(chatId);
    const message = messages
      .map(asRecord)
      .find((candidate) => opaqueId(candidate?.["id"]) === messageId);
    const domIndex = message?.["domIndex"];
    if (
      typeof domIndex !== "number"
      || !Number.isSafeInteger(domIndex)
      || domIndex < 0
    ) {
      throw new TypeError("Message is unavailable");
    }
    const item = this.options.page.locator(
      `main [data-index="${String(domIndex)}"]`
    );
    await item.waitFor({ state: "visible", timeout: MAX_ACTION_WAIT_MS });
    await item.scrollIntoViewIfNeeded();
    await item.click({ button: "right", timeout: MAX_ACTION_WAIT_MS });
    const dialog = this.options.page.getByRole("dialog").last();
    await dialog.waitFor({ state: "visible", timeout: MAX_ACTION_WAIT_MS });
    return dialog;
  }

  private async openStickerPanel(): Promise<Locator> {
    await this.dismissOpenDialog();
    const trigger = this.options.page.getByRole("button", {
      name: "Открыть меню стикеров",
      exact: true
    });
    await trigger.waitFor({ state: "visible", timeout: MAX_ACTION_WAIT_MS });
    await trigger.click({ timeout: MAX_ACTION_WAIT_MS });
    const dialog = this.options.page.getByRole("dialog").last();
    await dialog.waitFor({ state: "visible", timeout: MAX_ACTION_WAIT_MS });
    const stickersTab = dialog.getByRole("button", {
      name: "Стикеры",
      exact: true
    });
    if (await stickersTab.count() === 1) {
      await stickersTab.click({ timeout: MAX_ACTION_WAIT_MS });
    }
    return dialog;
  }

  private async openChatMenu(
    chatId: string,
    title: string
  ): Promise<Locator> {
    await this.dismissOpenDialog();
    const domIndex = await this.readChatDomIndex(chatId);
    let more = domIndex === undefined
      ? this.options.page.locator("[data-maxbridge-never]")
      : this.options.page.locator(
          `[data-index="${String(domIndex)}"] button[aria-label="Еще"]`
        );
    if (await more.count() !== 1) {
      const search = this.options.page.getByRole("textbox", {
        name: "Найти",
        exact: true
      });
      await search.waitFor({ state: "visible", timeout: MAX_ACTION_WAIT_MS });
      await search.fill(title);
      const cell = this.options.page.locator("button.cell").filter({
        has: this.options.page.getByRole("heading", {
          name: title,
          exact: true
        })
      });
      await cell.waitFor({ state: "visible", timeout: MAX_ACTION_WAIT_MS });
      more = cell.locator("..").getByRole("button", {
        name: "Еще",
        exact: true
      });
    }
    if (await more.count() !== 1) {
      throw new Error("MAX chat menu is unavailable");
    }
    await more.click({ timeout: MAX_ACTION_WAIT_MS });
    const dialog = this.options.page.getByRole("dialog").last();
    await dialog.waitFor({ state: "visible", timeout: MAX_ACTION_WAIT_MS });
    return dialog;
  }

  private async dismissOpenDialog(): Promise<void> {
    const dialogs = this.options.page.getByRole("dialog");
    if (await dialogs.count() > 0) {
      await dialogs.last().press("Escape").catch(() => undefined);
    }
  }

  private async clickMenuItem(
    dialog: Locator,
    label: string
  ): Promise<void> {
    await this.clickFirstMenuItem(dialog, [label]);
  }

  private async clickFirstMenuItem(
    dialog: Locator,
    labels: readonly string[]
  ): Promise<void> {
    for (const label of labels) {
      const item = dialog.getByRole("menuitem", {
        name: label,
        exact: true
      });
      if (await item.count() === 1) {
        await item.click({ timeout: MAX_ACTION_WAIT_MS });
        return;
      }
    }
    await dialog.press("Escape").catch(() => undefined);
    throw new Error("MAX action is unavailable");
  }

  private async confirmDestructiveAction(
    labels: readonly string[]
  ): Promise<void> {
    const deadline = Date.now() + Math.min(MAX_ACTION_WAIT_MS, 3_000);
    while (Date.now() <= deadline) {
      for (const label of labels) {
        const buttons = this.options.page.getByRole("button", {
          name: label,
          exact: true
        });
        const count = await buttons.count();
        if (count > 0) {
          const button = buttons.last();
          if (await button.isVisible()) {
            await button.click({ timeout: MAX_ACTION_WAIT_MS });
            return;
          }
        }
      }
      const dialogs = this.options.page.getByRole("dialog");
      if (await dialogs.count() < 1) {
        return;
      }
      await this.options.page.waitForTimeout(100);
    }
    const dialogs = this.options.page.getByRole("dialog");
    const confirmation = dialogs.last();
    await confirmation.press("Escape").catch(() => undefined);
    throw new Error("MAX confirmation is unavailable");
  }

  private async waitForMessage(
    chatId: string,
    messageId: string,
    predicate: (message: Record<string, unknown>) => boolean,
    acceptMissing = false
  ): Promise<boolean> {
    const deadline = Date.now() + MAX_ACTION_WAIT_MS;
    while (Date.now() <= deadline) {
      const messages = await this.readMessages(chatId);
      const message = messages
        .map(asRecord)
        .find((candidate) => opaqueId(candidate?.["id"]) === messageId);
      if (message === undefined) {
        if (acceptMissing) {
          return true;
        }
      } else if (predicate(message)) {
        return true;
      }
      await this.options.page.waitForTimeout(MAX_HISTORY_POLL_MS);
    }
    return false;
  }

  private async readSelectedReaction(
    chatId: string,
    messageId: string
  ): Promise<MaxReactionKey | undefined> {
    const messages = await this.readMessages(chatId);
    const message = messages
      .map(asRecord)
      .find((candidate) => opaqueId(candidate?.["id"]) === messageId);
    const reactions = Array.isArray(message?.["reactions"])
      ? message["reactions"] as unknown[]
      : [];
    for (const value of reactions) {
      const reaction = asRecord(value);
      const key = reaction?.["key"];
      if (
        reaction?.["selectedByMe"] === true
        && typeof key === "string"
        && isMaxReactionKey(key)
      ) {
        return key;
      }
    }
    return undefined;
  }

  private async waitForSelectedReaction(
    chatId: string,
    messageId: string,
    expected: MaxReactionKey | undefined
  ): Promise<boolean> {
    const deadline = Date.now() + MAX_ACTION_WAIT_MS;
    while (Date.now() <= deadline) {
      if (
        await this.readSelectedReaction(chatId, messageId)
        === expected
      ) {
        return true;
      }
      await this.options.page.waitForTimeout(MAX_HISTORY_POLL_MS);
    }
    return false;
  }

  private readChatDomIndex(
    chatId: string
  ): Promise<number | undefined> {
    return this.options.page.evaluate((input) => {
      const accessorValue = (
        globalThis as Record<PropertyKey, unknown>
      )[Symbol.for(input.accessorKey)];
      if (typeof accessorValue !== "function") {
        return undefined;
      }
      const accessor = accessorValue as () => {
        viewer?: { folders?: { all?: { chats?: unknown } } };
      };
      const chats = accessor().viewer?.folders?.all?.chats;
      const values = chats !== null
        && typeof chats === "object"
        && Symbol.iterator in chats
        ? Array.from(chats as Iterable<unknown>)
        : [];
      const index = values.findIndex((entry) => {
        const tuple: unknown[] | undefined = Array.isArray(entry)
          ? entry as unknown[]
          : undefined;
        const value: unknown = tuple?.length === 2 ? tuple[1] : entry;
        const candidate = value !== null && typeof value === "object"
          ? value as Record<string, unknown>
          : undefined;
        const raw = candidate?.["$"] !== null
          && typeof candidate?.["$"] === "object"
          ? candidate["$"] as Record<string, unknown>
          : undefined;
        const tupleId: unknown = tuple?.[0];
        const id: unknown = candidate?.["id"] ?? raw?.["id"] ?? tupleId;
        return (
          typeof id === "string"
          || typeof id === "number"
          || typeof id === "bigint"
        ) && String(id) === input.chatId;
      });
      return index < 0 ? undefined : index;
    }, { accessorKey: MAX_SESSION_ACCESSOR_KEY, chatId });
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.clearPendingSend();
    this.adapter?.close();
    this.adapter = undefined;
    await this.options.page.close();
  }

  private async ensureBindings(): Promise<MaxClientBindings> {
    if (this.bindings !== undefined) {
      return this.bindings;
    }
    const nodeModuleUrl = await this.options.page.evaluate(
      (pattern) => {
        const links = Array.from(document.querySelectorAll(
          'link[rel="modulepreload"]'
        ));
        const href = links
          .map((link) => (link as HTMLLinkElement).href)
          .find((candidate) => candidate.includes(pattern));
        if (href === undefined) {
          throw new Error("node module");
        }
        return href;
      },
      MAX_NODE_MODULE_PATTERN
    );
    const source = await this.options.page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) {
        throw new Error("node module");
      }
      return response.text();
    }, nodeModuleUrl);
    this.bindings = discoverMaxClientBindings(source, nodeModuleUrl);
    return this.bindings;
  }

  private async isAuthenticated(): Promise<boolean> {
    try {
      return await this.options.page.evaluate((accessorKey) => {
        const accessorValue = (
          globalThis as Record<PropertyKey, unknown>
        )[Symbol.for(accessorKey)];
        if (typeof accessorValue !== "function") {
          return false;
        }
        const accessor = accessorValue as () =>
          { viewer?: { id?: unknown } } | undefined;
        const session = accessor();
        return session?.viewer?.id !== undefined;
      }, MAX_SESSION_ACCESSOR_KEY);
    } catch {
      return false;
    }
  }

  private async ensureAdapter(): Promise<MaxSession> {
    if (this.adapter !== undefined) {
      return this.adapter;
    }
    const deadline = Date.now() + MAX_SESSION_READY_WAIT_MS;
    while (Date.now() <= deadline) {
      const viewerId = await this.readViewerId();
      if (viewerId !== "0") {
        return this.ensureViewer(viewerId);
      }
      await this.options.page.waitForTimeout(50);
    }
    throw new Error("MAX session is not authenticated");
  }

  private readViewerId(): Promise<string> {
    return this.options.page.evaluate((accessorKey) => {
      const accessorValue = (
        globalThis as Record<PropertyKey, unknown>
      )[Symbol.for(accessorKey)];
      if (typeof accessorValue !== "function") {
        return "0";
      }
      const accessor = accessorValue as () =>
        { viewer?: { id?: unknown } } | undefined;
      const session = accessor();
      const id = session?.viewer?.id;
      return typeof id === "bigint" || typeof id === "number"
        ? String(id)
        : typeof id === "string" ? id : "0";
    }, MAX_SESSION_ACCESSOR_KEY);
  }

  private ensureViewer(viewerId: string): MaxSession {
    this.adapter ??= new MaxSession({ viewerId });
    return this.adapter;
  }

  private async readMessages(
    chatId: string
  ): Promise<unknown[]> {
    return this.options.page.evaluate((input) => {
      const accessorValue = (
        globalThis as Record<PropertyKey, unknown>
      )[Symbol.for(input.accessorKey)];
      if (typeof accessorValue !== "function") {
        throw new Error("binding");
      }
      const accessor = accessorValue as () => {
        viewer?: {
          id?: unknown;
          folders?: { all?: { chats?: unknown } };
        };
      };
      const session = accessor();
      const viewerId = safeOpaque(session.viewer?.id);
      const source = session.viewer?.folders?.all?.chats;
      const entries = source !== null
        && typeof source === "object"
        && Symbol.iterator in source
        ? Array.from(source as Iterable<unknown>)
        : [];
      const chat = entries
        .map((entry) => {
          const tuple = Array.isArray(entry)
            ? entry as unknown[]
            : undefined;
          const value = tuple?.length === 2 ? tuple[1] : entry;
          const candidate = asRecord(value);
          const raw = asRecord(candidate?.["$"]);
          return {
            id: safeOpaque(
              candidate?.["id"] ?? raw?.["id"] ?? tuple?.[0]
            ),
            value: candidate,
            raw
          };
        })
        .find((candidate) => candidate.id === input.chatId);
      if (chat === undefined) {
        return [];
      }
      const messageSource = chat.value?.["messages"] ?? chat.raw?.["messages"];
      const values = Array.isArray(messageSource)
        ? messageSource
        : messageSource !== null
          && typeof messageSource === "object"
          && Symbol.iterator in messageSource
          ? Array.from(messageSource as Iterable<unknown>)
          : [];
      const mediaByIndex = new Map<
        number,
        Array<{ url: string; type: "PHOTO" | "VIDEO" | "AUDIO" }>
      >();
      const reactionsByIndex = new Map<
        number,
        Array<{ count: number; selectedByMe: boolean }>
      >();
      const forwardedByIndex = new Map<
        number,
        {
          sourceName: string;
          text?: string;
          textLinks?: Array<{
            offset: number;
            length: number;
            url: string;
          }>;
        }
      >();
      for (const item of document.querySelectorAll<HTMLElement>(
        "main [data-index]"
      )) {
        const index = Number(item.dataset["index"]);
        if (!Number.isSafeInteger(index) || index < 0) {
          continue;
        }
        const urls = Array.from(item.querySelectorAll(
          "img[src], video[src], audio[src], a[href]"
        )).filter((element) =>
          element.closest(".avatarComposition") === null &&
          element.closest('button[aria-label="Перейти в канал"]') === null
        ).map((element) => ({
          url: element instanceof HTMLAnchorElement
            ? element.href
            : element.getAttribute("src") ?? "",
          type: element instanceof HTMLVideoElement
            ? "VIDEO" as const
            : element instanceof HTMLAudioElement
              ? "AUDIO" as const
              : "PHOTO" as const
        })).filter((entry) => isAllowedMediaUrl(entry.url));
        if (urls.length > 0) {
          mediaByIndex.set(index, urls);
        }
        const renderedReactions = Array.from(
          item.querySelectorAll<HTMLButtonElement>("button.reaction")
        ).map((button) => ({
          count: integer(button.textContent),
          selectedByMe: button.classList.contains("reaction--active")
        }));
        if (renderedReactions.length > 0) {
          reactionsByIndex.set(index, renderedReactions);
        }
        const forwarded = Array.from(
          item.querySelectorAll<HTMLElement>("span")
        ).some((element) => element.textContent.trim() === "Переслано:");
        if (forwarded) {
          const sourceName = item.querySelector<HTMLElement>(
            'button[aria-label="Перейти в канал"]'
          )?.textContent.replace(/\s+/gu, " ").trim().slice(0, 256);
          if (sourceName !== undefined && sourceName.length > 0) {
            const forwardedTextElement = item.querySelector<HTMLElement>(
              ".bubbleContent > span.text"
            );
            const forwardedText = forwardedTextElement?.textContent
              .slice(0, 65_536);
            const textLinks = forwardedTextElement === null
              ? []
              : renderedTextLinks(forwardedTextElement);
            forwardedByIndex.set(index, {
              sourceName,
              ...(forwardedText === undefined || forwardedText.length === 0
                ? {}
                : { text: forwardedText }),
              ...(textLinks.length === 0 ? {} : { textLinks })
            });
          }
        }
      }
      const messageOffset = Math.max(0, values.length - 200);
      return values.slice(-200).map((value, messageIndex) => {
        const tuple = Array.isArray(value)
          ? value as unknown[]
          : undefined;
        const candidate = asRecord(tuple?.length === 2 ? tuple[1] : value);
        const raw = asRecord(candidate?.["$"]);
        const message = candidate ?? {};
        const forwardedRecord = asRecord(
          message["forwarded"]
          ?? raw?.["forwarded"]
          ?? message["forwardedMessage"]
          ?? raw?.["forwardedMessage"]
          ?? message["forwardInfo"]
          ?? raw?.["forwardInfo"]
        );
        const forwardedSender = asRecord(
          forwardedRecord?.["sender"]
          ?? forwardedRecord?.["author"]
          ?? forwardedRecord?.["source"]
        );
        const text = readableText(
          message["text"],
          raw?.["text"],
          message["message"],
          raw?.["message"],
          message["caption"],
          raw?.["caption"],
          forwardedRecord?.["text"],
          forwardedRecord?.["message"],
          forwardedRecord?.["caption"]
        );
        const sender = message["sender"] ?? raw?.["sender"];
        const status = aliasedText(
          message,
          raw,
          ["status", "deliveryStatus", "ack"]
        );
        const normalizedAttaches = normalizeAttaches(
          message["attaches"] ?? raw?.["attaches"]
        );
        const domIndex = messageOffset + messageIndex;
        const mediaUrls = mediaByIndex.get(domIndex) ?? [];
        const renderedReactions = reactionsByIndex.get(domIndex) ?? [];
        const forwarded = forwardedByIndex.get(domIndex);
        const forwardedFrom = forwarded?.sourceName ?? readableText(
          message["forwardedFrom"],
          raw?.["forwardedFrom"],
          forwardedRecord?.["sourceName"],
          forwardedRecord?.["authorName"],
          forwardedRecord?.["title"],
          forwardedRecord?.["name"],
          forwardedSender?.["fullName"],
          forwardedSender?.["name"],
          forwardedSender?.["title"]
        );
        const forwardedTitle = typeof forwardedFrom === "string"
          ? forwardedFrom.slice(0, 256)
          : undefined;
        const forwardedChatId = trustedOpaque(
          forwardedRecord?.["sourceChatId"]
          ?? forwardedRecord?.["chatId"]
          ?? forwardedRecord?.["peerId"]
          ?? forwardedRecord?.["dialogId"]
          ?? forwardedSender?.["chatId"]
          ?? forwardedSender?.["peerId"]
          ?? forwardedSender?.["id"]
          ?? forwardedRecord?.["id"]
        );
        const forwardedKind = forwardedSourceKind(
          forwardedRecord?.["sourceType"]
          ?? forwardedRecord?.["chatType"]
          ?? forwardedRecord?.["kind"]
          ?? forwardedRecord?.["type"]
          ?? forwardedSender?.["kind"]
          ?? forwardedSender?.["type"]
        );
        const textLinks = forwarded?.textLinks ?? projectTextLinks(
          message["textLinks"]
          ?? raw?.["textLinks"]
          ?? message["entities"]
          ?? raw?.["entities"]
          ?? forwardedRecord?.["textLinks"]
          ?? forwardedRecord?.["entities"]
        );
        const reply = message["replyToId"]
          ?? raw?.["replyToId"]
          ?? message["replyTo"]
          ?? raw?.["replyTo"];
        const replyRecord = asRecord(reply);
        const replyToId = safeOptionalOpaque(
          replyRecord?.["id"] ?? replyRecord?.["messageId"] ?? reply
        );
        return {
          id: safeOpaque(message["id"] ?? raw?.["id"] ?? tuple?.[0]),
          domIndex,
          sender: safeOpaque(message["senderId"] ?? raw?.["senderId"]),
          senderName: sender !== null && typeof sender === "object"
            ? (sender as Record<string, unknown>)["fullName"]
            : undefined,
          ...(status === undefined ? {} : { status }),
          time: typeof (message["time"] ?? raw?.["time"]) === "bigint"
            ? String(message["time"] ?? raw?.["time"])
            : message["time"] ?? raw?.["time"] ?? Date.now(),
          type: message["type"] ?? raw?.["type"] ?? "MESSAGE",
          text: typeof text === "string" ? text : forwarded?.text,
          attaches: attachDomMediaUrls(normalizedAttaches, mediaUrls),
          ...(forwardedTitle === undefined || forwardedTitle.length === 0
            ? {}
            : { forwardedFrom: forwardedTitle }),
          ...(
            forwardedTitle === undefined
            || forwardedChatId === undefined
            || forwardedKind === undefined
              ? {}
              : {
                  forwardedSource: {
                    title: forwardedTitle,
                    chatId: forwardedChatId,
                    kind: forwardedKind
                  }
                }
          ),
          ...(textLinks.length === 0 ? {} : { textLinks }),
          ...(replyToId === undefined ? {} : { replyToId }),
          edited: Boolean(
            message["edited"]
            ?? raw?.["edited"]
            ?? message["isEdited"]
            ?? raw?.["isEdited"]
          ),
          deleted: Boolean(
            message["deleted"]
            ?? raw?.["deleted"]
            ?? message["isDeleted"]
            ?? raw?.["isDeleted"]
          ),
          reactions: normalizeReactions(
            message["reactions"]
            ?? raw?.["reactions"]
            ?? message["reactionSummary"]
            ?? raw?.["reactionSummary"],
            renderedReactions,
            viewerId
          )
        };
      });

      function asRecord(
        value: unknown
      ): Record<string, unknown> | undefined {
        return value !== null && typeof value === "object"
          ? value as Record<string, unknown>
          : undefined;
      }

      function normalizeAttaches(value: unknown): unknown[] {
        const container = asRecord(value);
        const rawContainer = asRecord(
          safeAttachmentValue(container, "$")
        );
        const entries = attachmentCollection(
          safeAttachmentValue(container, "attaches"),
          16
        ) ?? attachmentCollection(
          safeAttachmentValue(rawContainer, "attaches"),
          16
        ) ?? attachmentCollection(rawContainer, 16)
          ?? attachmentCollection(value, 16)
          ?? [];
        return entries.map(projectHistoryAttachment);
      }

      function projectHistoryAttachment(
        value: unknown
      ): Record<string, unknown> {
        const tuple = attachmentArray(value, 2);
        const tupleValue = tuple?.length === 2 ? tuple[1] : value;
        const attachment = asRecord(tupleValue);
        const raw = asRecord(safeAttachmentValue(attachment, "$"));
        const projected: Record<string, unknown> = {};
        const fields: readonly (
          readonly [string, "text" | "opaque" | "number", number]
        )[] = [
          ["_type", "text", 64],
          ["type", "text", 64],
          ["kind", "text", 64],
          ["mediaType", "text", 64],
          ["url", "text", 2_048],
          ["downloadUrl", "text", 2_048],
          ["baseUrl", "text", 2_048],
          ["baseRawUrl", "text", 2_048],
          ["photoToken", "text", 4_096],
          ["videoToken", "text", 4_096],
          ["token", "text", 4_096],
          ["photoId", "opaque", 512],
          ["videoId", "opaque", 512],
          ["fileId", "opaque", 512],
          ["id", "opaque", 512],
          ["name", "text", 255],
          ["fileName", "text", 255],
          ["filename", "text", 255],
          ["mimeType", "text", 255],
          ["mime", "text", 255],
          ["contentType", "text", 255],
          ["width", "number", 65_535],
          ["height", "number", 65_535],
          ["duration", "number", 86_400],
          ["durationMs", "number", 86_400_000],
          ["size", "number", 1_073_741_824],
          ["fileSize", "number", 1_073_741_824]
        ];
        for (const [field, kind, maximum] of fields) {
          const selected = attachmentScalar(
            safeAttachmentValue(attachment, field),
            kind,
            maximum
          ) ?? attachmentScalar(
            safeAttachmentValue(raw, field),
            kind,
            maximum
          );
          if (selected !== undefined) {
            projected[field] = selected;
          }
        }
        const previewData = attachmentBytes(
          safeAttachmentValue(attachment, "previewData")
        ) ?? attachmentBytes(safeAttachmentValue(raw, "previewData"));
        if (previewData !== undefined) {
          projected["previewData"] = previewData;
        }
        return projected;
      }

      function safeAttachmentValue(
        value: Record<string, unknown> | undefined,
        key: string
      ): unknown {
        try {
          return value?.[key];
        } catch {
          return undefined;
        }
      }

      function attachmentCollection(
        value: unknown,
        maximum: number
      ): unknown[] | undefined {
        const array = attachmentArray(value, maximum);
        if (array !== undefined) {
          return array;
        }
        try {
          if (
            value === null
            || typeof value !== "object"
            || !(Symbol.iterator in value)
          ) {
            return undefined;
          }
          const output: unknown[] = [];
          for (const entry of value as Iterable<unknown>) {
            output.push(entry);
            if (output.length >= maximum) {
              break;
            }
          }
          return output;
        } catch {
          return undefined;
        }
      }

      function attachmentArray(
        value: unknown,
        maximum: number
      ): unknown[] | undefined {
        try {
          if (!Array.isArray(value)) {
            return undefined;
          }
          const output: unknown[] = [];
          const length = Math.min(value.length, maximum);
          for (let index = 0; index < length; index += 1) {
            try {
              output.push(value[index]);
            } catch {
              output.push(undefined);
            }
          }
          return output;
        } catch {
          return undefined;
        }
      }

      function attachmentScalar(
        value: unknown,
        kind: "text" | "opaque" | "number",
        maximum: number
      ): string | number | undefined {
        if (kind === "text") {
          return typeof value === "string"
            ? value.slice(0, maximum)
            : undefined;
        }
        if (kind === "opaque") {
          if (
            typeof value !== "string"
            && typeof value !== "number"
            && typeof value !== "bigint"
          ) {
            return undefined;
          }
          const normalized = String(value);
          return normalized.length === 0
            ? undefined
            : normalized.slice(0, maximum);
        }
        const number = typeof value === "number"
          ? value
          : typeof value === "bigint"
            ? Number(value)
            : undefined;
        return number === undefined || !Number.isFinite(number)
          ? undefined
          : Math.min(maximum, Math.max(0, number));
      }

      function attachmentBytes(value: unknown): number[] | undefined {
        try {
          const byteLimit = 256 * 1_024;
          const values = value instanceof Uint8Array
            ? value.length > byteLimit
              ? undefined
              : Array.from(value)
            : attachmentArray(value, byteLimit + 1);
          if (values === undefined || values.length > byteLimit) {
            return undefined;
          }
          return values.every((entry) =>
            typeof entry === "number"
            && Number.isInteger(entry)
            && entry >= 0
            && entry <= 255
          ) ? values as number[] : undefined;
        } catch {
          return undefined;
        }
      }

      function attachDomMediaUrls(
        attaches: unknown[],
        urls: readonly {
          url: string;
          type: "PHOTO" | "VIDEO" | "AUDIO";
        }[]
      ): unknown[] {
        if (attaches.length === 0) {
          return urls.map((entry) => ({
            _type: entry.type,
            url: entry.url
          }));
        }
        let mediaIndex = 0;
        return attaches.map((value) => {
          const attachment = asRecord(value);
          const raw = asRecord(attachment?.["$"]);
          const typeValue = attachment?.["_type"]
            ?? attachment?.["type"]
            ?? raw?.["_type"]
            ?? raw?.["type"];
          const type = typeof typeValue === "string"
            ? typeValue.toUpperCase()
            : "";
          const isFile = type.includes("FILE");
          const canUseRenderedUrl = type.includes("PHOTO")
            || type.includes("IMAGE")
            || type.includes("VIDEO")
            || type.includes("AUDIO")
            || type.includes("VOICE")
            || type.includes("STICKER")
            || (!isFile && urls.length === attaches.length);
          const rendered = canUseRenderedUrl ? urls[mediaIndex] : undefined;
          if (rendered !== undefined) {
            mediaIndex += 1;
          }
          if (attachment === undefined || rendered === undefined) {
            return value;
          }
          const renderedType = type.length === 0
            ? rendered.type
            : typeValue;
          return renderedType === undefined
            ? { ...attachment, url: rendered.url }
            : {
                ...attachment,
                _type: renderedType,
                url: rendered.url
              };
        });
      }

      function readableText(...values: unknown[]): string | undefined {
        for (const value of values) {
          if (typeof value === "string") {
            return value;
          }
          const record = asRecord(value);
          if (record === undefined) {
            continue;
          }
          for (const key of ["plain", "text", "message", "caption"]) {
            const nested = record[key];
            if (typeof nested === "string") {
              return nested;
            }
          }
        }
        return undefined;
      }

      function renderedTextLinks(
        root: HTMLElement
      ): Array<{ offset: number; length: number; url: string }> {
        if (typeof document.createRange !== "function") {
          return [];
        }
        const output: Array<{
          offset: number;
          length: number;
          url: string;
        }> = [];
        for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
          "a[href]"
        )) {
          const url = safeHttpsUrl(anchor.href);
          const anchorText = anchor.textContent;
          if (url === undefined || anchorText.length === 0) {
            return [];
          }
          try {
            const range = document.createRange();
            range.selectNodeContents(root);
            range.setEndBefore(anchor);
            const offset = Array.from(range.toString()).length;
            const length = Array.from(anchorText).length;
            if (offset + length > Array.from(root.textContent).length) {
              return [];
            }
            output.push({ offset, length, url });
          } catch {
            return [];
          }
        }
        return output;
      }

      function projectTextLinks(
        value: unknown
      ): Array<{ offset: number; length: number; url: string }> {
        const values = Array.isArray(value)
          ? value.slice(0, 64)
          : [];
        const output: Array<{
          offset: number;
          length: number;
          url: string;
        }> = [];
        for (const entry of values) {
          const record = asRecord(entry);
          const offset = record?.["offset"];
          const length = record?.["length"];
          const url = safeHttpsUrl(
            record?.["url"]
            ?? record?.["href"]
            ?? record?.["link"]
          );
          if (
            typeof offset !== "number"
            || !Number.isSafeInteger(offset)
            || offset < 0
            || typeof length !== "number"
            || !Number.isSafeInteger(length)
            || length < 1
            || url === undefined
          ) {
            return [];
          }
          output.push({ offset, length, url });
        }
        return output;
      }

      function safeHttpsUrl(value: unknown): string | undefined {
        if (typeof value !== "string" || value.length > 4_096) {
          return undefined;
        }
        try {
          const parsed = new URL(value);
          return parsed.protocol === "https:"
            && parsed.hostname.length > 0
            && parsed.username.length === 0
            && parsed.password.length === 0
            ? parsed.href
            : undefined;
        } catch {
          return undefined;
        }
      }

      function forwardedSourceKind(
        value: unknown
      ): "direct" | "group" | "channel" | undefined {
        const normalized = typeof value === "string"
          ? value.toUpperCase()
          : "";
        if (normalized.includes("CHANNEL")) {
          return "channel";
        }
        if (
          normalized.includes("GROUP")
          || normalized.includes("CHAT")
        ) {
          return "group";
        }
        if (
          normalized.includes("DIRECT")
          || normalized.includes("DIALOG")
          || normalized.includes("USER")
        ) {
          return "direct";
        }
        return undefined;
      }

      function trustedOpaque(value: unknown): string | undefined {
        const normalized = safeOptionalOpaque(value);
        if (
          normalized === undefined
          || normalized.length === 0
          || normalized.length > 512
        ) {
          return undefined;
        }
        for (let index = 0; index < normalized.length; index += 1) {
          const code = normalized.charCodeAt(index);
          if (code <= 31 || code === 127) {
            return undefined;
          }
        }
        return normalized;
      }

      function aliasedText(
        primary: Record<string, unknown>,
        raw: Record<string, unknown> | undefined,
        aliases: readonly string[]
      ): string | undefined {
        for (const source of [primary, raw]) {
          for (const alias of aliases) {
            try {
              const value = source?.[alias];
              if (typeof value === "string") {
                return value;
              }
            } catch {
              // Ignore hostile record fields and continue through aliases.
            }
          }
        }
        return undefined;
      }

      function integer(value: unknown): number {
        const numeric = typeof value === "number"
          ? value
          : typeof value === "string" && value.trim().length > 0
            ? Number(value)
            : 0;
        return Number.isFinite(numeric)
          ? Math.max(0, Math.trunc(numeric))
          : 0;
      }

      function normalizeReactions(
        value: unknown,
        rendered: readonly {
          count: number;
          selectedByMe: boolean;
        }[],
        currentViewerId: string
      ): Array<{
        key: string;
        emoji: string;
        count: number;
        selectedByMe: boolean;
      }> {
        const container = asRecord(value);
        const rawContainer = asRecord(container?.["$"]);
        const source = container?.["items"]
          ?? container?.["reactions"]
          ?? rawContainer?.["items"]
          ?? rawContainer?.["reactions"]
          ?? value;
        const values = Array.isArray(source)
          ? source
          : source !== null
              && typeof source === "object"
              && Symbol.iterator in source
            ? Array.from(source as Iterable<unknown>)
            : [];
        const normalized = values.slice(0, 32).flatMap((entry, index) => {
          const tuple: unknown[] | undefined = Array.isArray(entry)
            ? entry as unknown[]
            : undefined;
          const tupleValue: unknown = tuple?.length === 2 ? tuple[1] : entry;
          const reaction = asRecord(tupleValue);
          const raw = asRecord(reaction?.["$"]);
          const key = normalizeReactionKey(
            reaction?.["key"]
            ?? raw?.["key"]
            ?? reaction?.["type"]
            ?? raw?.["type"]
            ?? reaction?.["reaction"]
            ?? raw?.["reaction"]
            ?? tuple?.[0]
            ?? index
          );
          if (key === undefined) {
            return [];
          }
          const authors = reaction?.["authors"]
            ?? raw?.["authors"]
            ?? reaction?.["users"]
            ?? raw?.["users"];
          const authorValues = Array.isArray(authors)
            ? authors
            : authors !== null
                && typeof authors === "object"
                && Symbol.iterator in authors
              ? Array.from(authors as Iterable<unknown>)
              : [];
          const renderedReaction = rendered[index];
          return [{
            key,
            emoji: reactionEmoji(key),
            count: integer(
              reaction?.["count"]
              ?? raw?.["count"]
              ?? reaction?.["total"]
              ?? raw?.["total"]
              ?? renderedReaction?.count
              ?? (authorValues.length || 1)
            ),
            selectedByMe: Boolean(
              reaction?.["selectedByMe"]
              ?? raw?.["selectedByMe"]
              ?? reaction?.["mine"]
              ?? raw?.["mine"]
              ?? renderedReaction?.selectedByMe
              ?? authorValues.some((author) =>
                safeOptionalOpaque(
                  asRecord(author)?.["id"] ?? author
                ) === currentViewerId
              )
            )
          }];
        });
        if (normalized.length > 0) {
          return normalized.filter((reaction) => reaction.count > 0);
        }
        return rendered.slice(0, 6).flatMap((reaction, index) => {
          const key = normalizeReactionKey(index);
          return key === undefined || reaction.count < 1
            ? []
            : [{
                key,
                emoji: reactionEmoji(key),
                count: reaction.count,
                selectedByMe: reaction.selectedByMe
              }];
        });
      }

      function normalizeReactionKey(value: unknown): string | undefined {
        const normalized = typeof value === "string"
          ? value.toUpperCase()
          : typeof value === "number" && Number.isSafeInteger(value)
            ? String(value)
            : "";
        if (
          normalized === "0"
          || normalized.includes("LIKE")
          || normalized.includes("THUMB")
        ) {
          return "like";
        }
        if (
          normalized === "1"
          || normalized.includes("HEART")
          || normalized.includes("LOVE")
        ) {
          return "heart";
        }
        if (
          normalized === "2"
          || normalized.includes("LAUGH")
          || normalized.includes("LOL")
          || normalized.includes("JOY")
        ) {
          return "laugh";
        }
        if (normalized === "3" || normalized.includes("FIRE")) {
          return "fire";
        }
        if (
          normalized === "4"
          || normalized.includes("CRY")
          || normalized.includes("SAD")
          || normalized.includes("TEAR")
        ) {
          return "cry";
        }
        if (
          normalized === "5"
          || normalized.includes("CELEBR")
          || normalized.includes("PARTY")
          || normalized.includes("WOW")
        ) {
          return "celebrate";
        }
        return undefined;
      }

      function reactionEmoji(key: string): string {
        return key === "like"
          ? "👍"
          : key === "heart"
            ? "❤️"
            : key === "laugh"
              ? "😂"
              : key === "fire"
                ? "🔥"
                : key === "cry"
                  ? "😭"
                  : "🎉";
      }

      function isAllowedMediaUrl(value: string): boolean {
        try {
          const url = new URL(value);
          return url.protocol === "https:"
            && url.hostname === "i.oneme.ru"
            && url.port.length === 0
            && url.username.length === 0
            && url.password.length === 0;
        } catch {
          return false;
        }
      }

      function safeOpaque(value: unknown): string {
        return (
          typeof value === "string"
          || typeof value === "number"
          || typeof value === "bigint"
        ) ? String(value) : "0";
      }

      function safeOptionalOpaque(value: unknown): string | undefined {
        return (
          typeof value === "string"
          || typeof value === "number"
          || typeof value === "bigint"
        ) ? String(value) : undefined;
      }
    }, { accessorKey: MAX_SESSION_ACCESSOR_KEY, chatId });
  }

  private async openChat(
    bindings: MaxClientBindings,
    chatId: string
  ): Promise<void> {
    await this.options.page.evaluate(async (input) => {
      const module = await import(input.moduleUrl) as Record<string, unknown>;
      const router = module[input.routerExport] as {
        openChat?: (id: bigint) => unknown;
      } | undefined;
      if (typeof router?.openChat !== "function") {
        throw new Error("binding");
      }
      await router.openChat(BigInt(input.chatId));
    }, { ...bindings, chatId });
  }

  private async activateChat(chatId: string): Promise<void> {
    const bindings = await this.ensureBindings();
    await this.openChat(bindings, chatId);
    try {
      await this.waitForChatReady(chatId);
      return;
    } catch {
      // The MAX SPA occasionally resolves openChat before its router commits
      // the route. A direct same-origin navigation is a safe recovery path.
      process.stderr.write(`${JSON.stringify({
        event: "max_chat_route_fallback"
      })}\n`);
    }

    this.bindings = undefined;
    await this.options.page.goto(
      new URL(encodeURIComponent(chatId), MAX_WEB_URL).href,
      { waitUntil: "domcontentloaded" }
    );
    await this.ensureBindings();
    await this.waitForChatReady(chatId);
  }

  private async waitForChatReady(chatId: string): Promise<void> {
    await this.options.page.waitForURL((url) =>
      chatIdFromPageUrl(url.href) === chatId,
    { timeout: 7_500 });
    await this.options.page
      .locator(MAX_COMPOSER_SELECTOR)
      .last()
      .waitFor({ state: "visible", timeout: 7_500 });
  }

  private observeSocket(socket: WebSocket): void {
    if (!socket.url().startsWith("wss://api.oneme.ru/")) {
      return;
    }
    socket.on("framereceived", (event) => {
      if (this.stopped || typeof event.payload === "string") {
        return;
      }
      const frame = Buffer.from(event.payload);
      try {
        const decoded = decodeMaxFrame(frame);
        if (decoded.command === 0 && decoded.opcode === 128) {
          const events = this.adapter?.ingestLive(decoded.payload) ?? [];
          if (events.length > 0) {
            this.options.onEvents?.(events);
          }
        } else if (decoded.command === 1 && decoded.opcode === 64) {
          const payload = asRecord(decoded.payload);
          const message = asRecord(payload?.["message"]);
          this.resolvePendingSend(opaqueId(message?.["id"]));
        }
      } catch {
        // Unknown frames are owned by the MAX client and ignored.
      } finally {
        frame.fill(0);
      }
    });
  }

  private resolvePendingSend(messageId: string | undefined): void {
    const pending = this.pendingSend;
    if (pending === undefined) {
      return;
    }
    this.pendingSend = undefined;
    clearTimeout(pending.timeout);
    pending.resolve(messageId);
  }

  private clearPendingSend(): void {
    const pending = this.pendingSend;
    this.pendingSend = undefined;
    if (pending !== undefined) {
      clearTimeout(pending.timeout);
      pending.resolve(undefined);
    }
  }
}

function isMaxReactionKey(value: string): value is MaxReactionKey {
  return (MAX_REACTION_ORDER as readonly string[]).includes(value);
}

function createOperationId(): string {
  const suffix = randomBytes(8).readBigUInt64BE();
  return (
    BigInt(Date.now()) * 10_000_000_000_000_000n
    + suffix % 10_000_000_000_000_000n
  ).toString();
}

function chatIdFromPageUrl(value: string): string | undefined {
  try {
    const segment = new URL(value).pathname.split("/").filter(Boolean)[0];
    return segment === undefined ? undefined : decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function historyFingerprint(messages: readonly unknown[]): string {
  return messages.map((value) => {
    const message = asRecord(value);
    const attachments = Array.isArray(message?.["attaches"])
      ? message["attaches"] as unknown[]
      : [];
    const reactions = Array.isArray(message?.["reactions"])
      ? message["reactions"] as unknown[]
      : [];
    return [
      opaqueId(message?.["id"]) ?? "",
      typeof message?.["text"] === "string" ? message["text"] : "",
      message?.["edited"] === true ? "edited" : "",
      message?.["deleted"] === true ? "deleted" : "",
      ...reactions.map((reaction) => {
        const record = asRecord(reaction);
        return [
          typeof record?.["key"] === "string" ? record["key"] : "",
          typeof record?.["count"] === "number" ? record["count"] : "",
          record?.["selectedByMe"] === true ? "mine" : ""
        ].join(":");
      }),
      ...attachments.map((attachment) => {
        const record = asRecord(attachment);
        return [
          typeof record?.["url"] === "string" ? record["url"] : "",
          typeof record?.["_type"] === "string" ? record["_type"] : ""
        ].join(":");
      })
    ].join("|");
  }).join("|");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}

async function validateTransientFile(filePath: string): Promise<string> {
  const root = resolve(MAX_MEDIA_ROOT);
  const canonical = await realpath(filePath);
  const fromRoot = relative(root, canonical);
  if (
    fromRoot.length < 1
    || fromRoot.startsWith("..")
    || resolve(root, fromRoot) !== canonical
  ) {
    throw new TypeError("Attachment path is invalid");
  }
  const details = await stat(canonical);
  if (!details.isFile() || details.size < 1 || details.size > 20 * 1024 * 1024) {
    throw new TypeError("Attachment file is invalid");
  }
  return canonical;
}

function opaqueId(value: unknown): string | undefined {
  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "bigint"
  ) {
    return String(value);
  }
  return undefined;
}
