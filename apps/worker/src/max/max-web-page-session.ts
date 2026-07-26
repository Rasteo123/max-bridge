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
const MAX_MEDIA_ROOT = "/run/maxbridge/media";

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
              type: isSaved
                ? "SAVED"
                : text(raw?.["type"])
                ?? (chat["recipient"] === undefined ? "CHAT" : "DIALOG"),
              title,
              avatarUrl: avatarByTitle.get(title),
              lastMessage: last === undefined
                ? undefined
                : {
                    id: opaque(last["id"]),
                    time: temporal(last["time"]),
                    text: richText(last["text"]),
                    attaches: attachments(last["attaches"])
                  },
              lastMessageTime: temporal(
                last?.["time"] ?? chat["sortTime"] ?? chat["lastEventTime"]
              ),
              unreadCount: integer(
                chat["newMessages"] ?? raw?.["newMessages"]
              ),
              muted: Boolean(chat["muted"] ?? false)
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
        function text(value: unknown): string | undefined {
          return typeof value === "string" ? value : undefined;
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
          const attach = record(value);
          const raw = attach === undefined ? undefined : record(attach["$"]);
          const source = raw?.["attaches"] ?? raw;
          return Array.isArray(source) ? source.slice(0, 8) : [];
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
    const bindings = await this.ensureBindings();
    const before = await this.readMessages(chatId);
    const currentChatId = chatIdFromPageUrl(this.options.page.url());
    const alternate = chats.find((chat) => chat.id !== chatId);
    if (
      currentChatId === chatId
      && before.length <= 1
      && alternate !== undefined
    ) {
      await this.openChat(bindings, alternate.id);
      await this.options.page.waitForTimeout(200);
    }
    await this.openChat(bindings, chatId);

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

  async sendText(chatId: string, textValue: string): Promise<Readonly<{
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
        .locator('[contenteditable="true"][role="textbox"], textarea')
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
      await fileInput.evaluate((element, kind) => {
        if (!(element instanceof HTMLInputElement)) {
          throw new TypeError("MAX file input is invalid");
        }
        element.accept = kind === "media" ? "image/*, video/*" : "";
      }, input.kind);
      await fileInput.setInputFiles(filePath);
      stage = "wait_for_preview";
      await this.options.page.waitForFunction(() =>
        document.querySelector(
          'button:has(use[href="#icon_cross_round_fill_mini_color"])'
        ) !== null,
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
        viewer?: { folders?: { all?: { chats?: unknown } } };
      };
      const session = accessor();
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
      const mediaByIndex = new Map<number, string[]>();
      for (const item of document.querySelectorAll<HTMLElement>(
        "main [data-index]"
      )) {
        const index = Number(item.dataset["index"]);
        if (!Number.isSafeInteger(index) || index < 0) {
          continue;
        }
        const urls = Array.from(item.querySelectorAll(
          "img[src], video[src], audio[src], a[href]"
        )).map((element) =>
          element instanceof HTMLAnchorElement
            ? element.href
            : element.getAttribute("src") ?? ""
        ).filter(isAllowedMediaUrl);
        if (urls.length > 0) {
          mediaByIndex.set(index, urls);
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
        const textValue = message["text"] ?? raw?.["text"];
        const text = typeof textValue === "string"
          ? textValue
          : textValue !== null && typeof textValue === "object"
            ? (textValue as Record<string, unknown>)["plain"]
            : undefined;
        const sender = message["sender"] ?? raw?.["sender"];
        const normalizedAttaches = normalizeAttaches(
          message["attaches"] ?? raw?.["attaches"]
        );
        const mediaUrls = mediaByIndex.get(messageOffset + messageIndex) ?? [];
        return {
          id: safeOpaque(message["id"] ?? raw?.["id"] ?? tuple?.[0]),
          sender: safeOpaque(message["senderId"] ?? raw?.["senderId"]),
          senderName: sender !== null && typeof sender === "object"
            ? (sender as Record<string, unknown>)["fullName"]
            : undefined,
          time: typeof (message["time"] ?? raw?.["time"]) === "bigint"
            ? String(message["time"] ?? raw?.["time"])
            : message["time"] ?? raw?.["time"] ?? Date.now(),
          type: message["type"] ?? raw?.["type"] ?? "MESSAGE",
          text: typeof text === "string" ? text : undefined,
          attaches: attachDomMediaUrls(normalizedAttaches, mediaUrls)
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
        if (Array.isArray(value)) {
          return value.slice(0, 16);
        }
        if (
          value !== null
          && typeof value === "object"
          && Symbol.iterator in value
        ) {
          return Array.from(value as Iterable<unknown>).slice(0, 16);
        }
        return [];
      }

      function attachDomMediaUrls(
        attaches: unknown[],
        urls: readonly string[]
      ): unknown[] {
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
          const canUseRenderedUrl = type.includes("PHOTO")
            || type.includes("IMAGE")
            || type.includes("VIDEO")
            || type.includes("AUDIO")
            || type.includes("VOICE");
          const url = canUseRenderedUrl ? urls[mediaIndex] : undefined;
          if (canUseRenderedUrl) {
            mediaIndex += 1;
          }
          return attachment === undefined || url === undefined
            ? value
            : { ...attachment, url };
        });
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
    return opaqueId(message?.["id"]) ?? "";
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
