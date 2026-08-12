import { createReadStream } from "node:fs";

import {
  parseAccountSettings,
  parseBridgeEvent,
  parseChatSummary,
  parseMessage,
  parseStickerSummary,
  zeroBuffer,
  type AccountSettings,
  type BridgeEvent,
  type ChatAction,
  type ChatSummary,
  type Message,
  type ReactionEmoji,
  type StickerSummary,
  type UserRecord,
  type UserState
} from "@maxbridge/core";
import type { MaxLoginResult } from "@maxbridge/max-adapter";
import type { WorkerEvent } from "@maxbridge/protocol";
import {
  WorkerRequestError,
  type WorkerClientRequest
} from "../worker/worker-client.js";

import type { ChatGateway } from "../routes/chats.js";
import type {
  CaptchaPointerInput,
  MaxLoginGateway
} from "../routes/max-login.js";
import type {
  MediaDownload,
  MediaGateway
} from "../routes/media.js";
import type {
  MessageGateway,
  MessageRouteResult
} from "../routes/messages.js";
import type { LiveGateway } from "../routes/websocket.js";

export interface RuntimeWorker {
  request(request: WorkerClientRequest): Promise<unknown>;
  subscribe(listener: (event: WorkerEvent) => void): () => void;
  subscribeConnection?(
    listener: (connected: boolean) => void
  ): () => void;
}

export interface RuntimeUsers {
  loadMaxSessionByLookup(lookupId: string): Promise<Uint8Array | null>;
  saveMaxSessionByLookup(
    lookupId: string,
    storageState: Uint8Array
  ): Promise<void>;
  clearMaxSessionByLookup(lookupId: string): void;
  findUserByLookup(lookupId: string): UserRecord | null;
  transitionByLookup(
    lookupId: string,
    state: UserState
  ): UserRecord;
}

const RUNTIME_MEDIA_ROOT = "/run/maxbridge/media";

export class BridgeRuntimeGateway implements
  ChatGateway,
  MaxLoginGateway,
  MediaGateway,
  MessageGateway,
  LiveGateway {
  private readonly opened = new Set<string>();
  private readonly opening = new Map<string, Promise<void>>();
  private readonly sessionGeneration = new Map<string, number>();
  private readonly loggingOut = new Set<string>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly sessionWrites = new Map<string, Set<Promise<void>>>();
  private readonly pendingWorkerCloses = new Set<string>();
  private readonly workerClosing = new Map<string, Promise<void>>();
  private readonly revokedSessions = new Set<string>();
  private readonly restoreRetryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly restoreRetryAttempts = new Map<string, number>();
  private readonly listeners = new Map<
    string,
    Set<(event: BridgeEvent) => void>
  >();
  private readonly globalListeners = new Set<
    (userLookup: string, event: BridgeEvent) => void
  >();
  private readonly backgroundTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(private readonly options: Readonly<{
    worker: RuntimeWorker;
    users: RuntimeUsers;
    onSessionRecoveryError?(error: unknown): void;
  }>) {
    options.worker.subscribe((event) => {
      this.handleWorkerEvent(event);
    });
    options.worker.subscribeConnection?.((connected) => {
      if (connected) {
        this.retryPendingWorkerCloses();
        this.restoreOpenedSessions();
      }
    });
  }

  async submitPhone(
    userLookup: string,
    phone: Uint8Array
  ): Promise<MaxLoginResult> {
    await this.ensureSession(userLookup);
    this.beginAuthentication(userLookup);
    return parseLoginResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "login.phone",
      sessionHandle: sessionHandle(userLookup),
      payload: { phone: new TextDecoder().decode(phone) }
    }));
  }

  async submitCode(
    userLookup: string,
    code: Uint8Array
  ): Promise<MaxLoginResult> {
    await this.ensureSession(userLookup);
    const generation = this.sessionGeneration.get(userLookup) ?? 0;
    this.beginAuthentication(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "login.code",
      sessionHandle: sessionHandle(userLookup),
      payload: { code: new TextDecoder().decode(code) }
    }));
    const result = parseLoginResult(response["result"]);
    if (result.state !== "authenticated") {
      return result;
    }
    const encoded = response["storageStateBase64"];
    if (
      typeof encoded !== "string"
      || encoded.length < 4
      || encoded.length > 2 * 1024 * 1024
    ) {
      throw new TypeError("MAX storage state is unavailable");
    }
    const storageState = Buffer.from(encoded, "base64");
    try {
      await this.persistAuthenticatedSession(
        userLookup,
        storageState,
        generation
      );
    } finally {
      zeroBuffer(storageState);
    }
    return result;
  }

  async getQrPng(userLookup: string): Promise<Buffer> {
    await this.ensureSession(userLookup);
    this.beginAuthentication(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "login.qr",
      sessionHandle: sessionHandle(userLookup)
    }));
    const encoded = response["pngBase64"];
    if (
      typeof encoded !== "string"
      || encoded.length < 4
      || encoded.length > 2 * 1024 * 1024
    ) {
      throw new TypeError("MAX QR image is invalid");
    }
    return Buffer.from(encoded, "base64");
  }

  async getCaptchaPng(userLookup: string): Promise<Buffer> {
    await this.ensureSession(userLookup);
    this.beginAuthentication(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "login.captcha.frame",
      sessionHandle: sessionHandle(userLookup)
    }));
    return parsePng(response["pngBase64"], "MAX CAPTCHA image is invalid");
  }

  async sendCaptchaPointer(
    userLookup: string,
    input: CaptchaPointerInput
  ): Promise<MaxLoginResult> {
    await this.ensureSession(userLookup);
    this.beginAuthentication(userLookup);
    return parseLoginResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "login.captcha.pointer",
      sessionHandle: sessionHandle(userLookup),
      payload: input
    }));
  }

  async status(userLookup: string): Promise<MaxLoginResult> {
    await this.ensureSession(userLookup);
    return parseLoginResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "login.status",
      sessionHandle: sessionHandle(userLookup)
    }));
  }

  logout(userLookup: string): Promise<void> {
    const existing = this.closing.get(userLookup);
    if (existing !== undefined) {
      return existing;
    }
    const operation = this.closeSession(userLookup);
    const closing = operation.finally(() => {
      if (this.closing.get(userLookup) === closing) {
        this.closing.delete(userLookup);
      }
    });
    this.closing.set(userLookup, closing);
    return closing;
  }

  private async closeSession(userLookup: string): Promise<void> {
    this.cancelSessionRestoreRetry(userLookup);
    this.loggingOut.add(userLookup);
    this.revokedSessions.add(userLookup);
    this.sessionGeneration.set(
      userLookup,
      (this.sessionGeneration.get(userLookup) ?? 0) + 1
    );
    try {
      const opening = this.opening.get(userLookup);
      if (opening !== undefined) {
        await opening.catch(() => undefined);
      }
      this.opened.delete(userLookup);
      this.pendingWorkerCloses.add(userLookup);
      await this.drainPendingWorkerClose(userLookup).catch(
        (error: unknown) => {
          this.options.onSessionRecoveryError?.(error);
        }
      );
      const writes = [...(this.sessionWrites.get(userLookup) ?? [])];
      if (writes.length > 0) {
        await Promise.allSettled(writes);
      }
    } finally {
      try {
        this.options.users.clearMaxSessionByLookup(userLookup);
        const state = this.options.users.findUserByLookup(userLookup)?.state;
        if (state === "active") {
          this.options.users.transitionByLookup(
            userLookup,
            "reauth_required"
          );
        }
      } finally {
        this.opened.delete(userLookup);
        this.loggingOut.delete(userLookup);
      }
    }
  }

  async list(userLookup: string): Promise<readonly ChatSummary[]> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "chats.list",
      sessionHandle: sessionHandle(userLookup)
    }));
    const chats = response["chats"];
    if (!Array.isArray(chats)) {
      throw new TypeError("MAX chat list is invalid");
    }
    return chats.map(parseChatSummary);
  }

  async settings(userLookup: string): Promise<AccountSettings> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "settings.read",
      sessionHandle: sessionHandle(userLookup)
    }));
    return parseAccountSettings(response["settings"]);
  }

  async joinChat(
    userLookup: string,
    link: string
  ): Promise<ChatSummary | null> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "chats.subscribe",
      sessionHandle: sessionHandle(userLookup),
      payload: { link }
    }));
    const chat = response["chat"];
    return chat === null || chat === undefined
      ? null
      : parseChatSummary(chat);
  }

  async leaveChat(
    userLookup: string,
    chatId: string
  ): Promise<boolean> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "chats.unsubscribe",
      sessionHandle: sessionHandle(userLookup),
      payload: { chatId }
    }));
    return response["unsubscribed"] === true;
  }

  async markRead(
    userLookup: string,
    chatId: string,
    messageId: string
  ): Promise<boolean> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "messages.read",
      sessionHandle: sessionHandle(userLookup),
      payload: { chatId, messageId }
    }));
    return response["read"] === true;
  }

  async resolveChat(
    userLookup: string,
    chatId: string
  ): Promise<ChatSummary | null> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "chats.resolve",
      sessionHandle: sessionHandle(userLookup),
      payload: { chatId }
    }));
    const chat = response["chat"];
    return chat === null || chat === undefined
      ? null
      : parseChatSummary(chat);
  }

  async describeContact(
    userLookup: string,
    contactId: string
  ): Promise<ChatSummary | null> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "contacts.describe",
      sessionHandle: sessionHandle(userLookup),
      payload: { contactId }
    }));
    const contact = response["contact"];
    return contact === null || contact === undefined
      ? null
      : parseChatSummary(contact);
  }

  async comments(
    userLookup: string,
    chatId: string,
    postId: string
  ): Promise<readonly Message[] | null> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "messages.comments",
      sessionHandle: sessionHandle(userLookup),
      payload: { chatId, postId }
    }));
    const messages = response["messages"];
    if (messages === null) {
      return null;
    }
    if (!Array.isArray(messages)) {
      throw new TypeError("MAX comments are invalid");
    }
    return messages.map(parseMessage);
  }

  async search(
    userLookup: string,
    query: string
  ): Promise<readonly ChatSummary[]> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "chats.search",
      sessionHandle: sessionHandle(userLookup),
      payload: { query }
    }));
    const chats = response["chats"];
    if (!Array.isArray(chats)) {
      throw new TypeError("MAX search result is invalid");
    }
    return chats.map(parseChatSummary);
  }

  async history(
    userLookup: string,
    chatId: string,
    cursor?: string
  ): Promise<readonly Message[] | null> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "messages.history",
      sessionHandle: sessionHandle(userLookup),
      payload: {
        chatId,
        ...(cursor === undefined ? {} : { cursor })
      }
    }));
    const messages = response["messages"];
    if (messages === null) {
      return null;
    }
    if (!Array.isArray(messages)) {
      throw new TypeError("MAX history is invalid");
    }
    return messages.map(parseMessage);
  }

  async sendText(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      clientRequestId: string;
      text: Uint8Array;
      replyToId?: string;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "message.send",
      sessionHandle: sessionHandle(userLookup),
      payload: {
        chatId: input.chatId,
        clientRequestId: input.clientRequestId,
        text: new TextDecoder().decode(input.text),
        ...(input.replyToId === undefined
          ? {}
          : { replyToId: input.replyToId })
      }
    }));
  }

  async retryText(
    userLookup: string,
    input: Readonly<{
      retryOf: string;
      chatId: string;
      clientRequestId: string;
      text: Uint8Array;
      replyToId?: string;
      confirmedByUser: true;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "message.send",
      sessionHandle: sessionHandle(userLookup),
      payload: {
        chatId: input.chatId,
        clientRequestId: input.clientRequestId,
        text: new TextDecoder().decode(input.text),
        ...(input.replyToId === undefined
          ? {}
          : { replyToId: input.replyToId }),
        retryOf: input.retryOf,
        confirmedByUser: true
      }
    }));
  }

  async sendAttachment(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      clientRequestId: string;
      filePath: string;
      kind: "media" | "file";
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "message.sendAttachment",
      sessionHandle: sessionHandle(userLookup),
      payload: input
    }));
  }

  async editMessage(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      messageId: string;
      clientRequestId: string;
      text: Uint8Array;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "message.edit",
      sessionHandle: sessionHandle(userLookup),
      payload: {
        chatId: input.chatId,
        messageId: input.messageId,
        clientRequestId: input.clientRequestId,
        text: new TextDecoder().decode(input.text)
      }
    }));
  }

  async deleteMessage(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      messageId: string;
      clientRequestId: string;
      confirmedByUser: true;
      forEveryone: boolean;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "message.delete",
      sessionHandle: sessionHandle(userLookup),
      payload: input
    }));
  }

  async forwardMessage(
    userLookup: string,
    input: Readonly<{
      sourceChatId: string;
      sourceMessageId: string;
      destinationIds: readonly string[];
      clientRequestId: string;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "message.forward",
      sessionHandle: sessionHandle(userLookup),
      payload: {
        sourceChatId: input.sourceChatId,
        sourceMessageId: input.sourceMessageId,
        destinationIds: [...input.destinationIds],
        clientRequestId: input.clientRequestId
      }
    }));
  }

  async setReaction(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      messageId: string;
      clientRequestId: string;
      reaction: ReactionEmoji | null;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "message.reaction.set",
      sessionHandle: sessionHandle(userLookup),
      payload: input
    }));
  }

  async chatAction(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      clientRequestId: string;
      action: ChatAction;
      confirmedByUser?: true;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "chat.action",
      sessionHandle: sessionHandle(userLookup),
      payload: input
    }));
  }

  /**
   * Streams an attachment the worker fetched. MAX signs its links for the
   * address that requested them, so the bytes travel through here.
   */
  async open(
    userLookup: string,
    handle: string
  ): Promise<MediaDownload | null> {
    await this.ensureSession(userLookup);
    let response: Record<string, unknown>;
    try {
      response = record(await this.requestWithSessionRecovery(userLookup, {
        operation: "media.open",
        sessionHandle: sessionHandle(userLookup),
        payload: { handle }
      }));
    } catch {
      return null;
    }
    const path = response["path"];
    const mimeType = response["mimeType"];
    const fileName = response["fileName"];
    const size = response["size"];
    const expiresAt = response["expiresAt"];
    if (
      typeof path !== "string"
      // The worker writes into the shared media directory and nowhere else.
      || !path.startsWith(`${RUNTIME_MEDIA_ROOT}/`)
      || path.includes("..")
      || typeof mimeType !== "string"
      || typeof fileName !== "string"
      || typeof size !== "number"
      || !Number.isSafeInteger(size)
      || size < 0
      || typeof expiresAt !== "number"
      || !Number.isSafeInteger(expiresAt)
    ) {
      return null;
    }
    return {
      stream: createReadStream(path),
      mimeType,
      fileName,
      size,
      expiresAt
    };
  }

  async listStickers(
    userLookup: string,
    chatId: string
  ): Promise<readonly StickerSummary[]> {
    await this.ensureSession(userLookup);
    const response = record(await this.requestWithSessionRecovery(userLookup, {
      operation: "stickers.list",
      sessionHandle: sessionHandle(userLookup),
      payload: { chatId }
    }));
    const stickers = response["stickers"];
    if (!Array.isArray(stickers)) {
      throw new TypeError("MAX sticker list is invalid");
    }
    return stickers.map(parseStickerSummary);
  }

  async sendSticker(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      stickerId: string;
      clientRequestId: string;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.requestWithSessionRecovery(userLookup, {
      operation: "sticker.send",
      sessionHandle: sessionHandle(userLookup),
      payload: input
    }));
  }

  async canAccessChat(
    userLookup: string,
    chatId: string
  ): Promise<boolean> {
    return (await this.list(userLookup)).some((chat) => chat.id === chatId);
  }

  subscribe(
    userLookup: string,
    listener: (event: BridgeEvent) => void
  ): () => void {
    const backgroundTimer = this.backgroundTimers.get(userLookup);
    if (backgroundTimer !== undefined) {
      clearTimeout(backgroundTimer);
      this.backgroundTimers.delete(userLookup);
    }
    const listeners = this.listeners.get(userLookup) ?? new Set();
    listeners.add(listener);
    this.listeners.set(userLookup, listeners);
    void this.ensureSession(userLookup).catch(() => undefined);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(userLookup);
        this.scheduleBackground(userLookup);
      }
    };
  }

  subscribeAll(
    listener: (userLookup: string, event: BridgeEvent) => void
  ): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private async ensureSession(userLookup: string): Promise<void> {
    if (this.loggingOut.has(userLookup)) {
      throw new Error("Session lifecycle changed");
    }
    await this.drainPendingWorkerClose(userLookup);
    if (this.loggingOut.has(userLookup)) {
      throw new Error("Session lifecycle changed");
    }
    if (this.opened.has(userLookup)) {
      return;
    }
    const existing = this.opening.get(userLookup);
    if (existing !== undefined) {
      await existing;
      return;
    }
    const opening = this.openSession(userLookup).finally(() => {
      this.opening.delete(userLookup);
    });
    this.opening.set(userLookup, opening);
    await opening;
  }

  private scheduleBackground(userLookup: string): void {
    if (
      this.backgroundTimers.has(userLookup) ||
      !this.opened.has(userLookup)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      this.backgroundTimers.delete(userLookup);
      if (
        this.listeners.has(userLookup) ||
        !this.opened.has(userLookup)
      ) {
        return;
      }
      void this.options.worker.request({
        operation: "session.background",
        sessionHandle: sessionHandle(userLookup)
      }).catch(() => undefined);
    }, 250);
    this.backgroundTimers.set(userLookup, timer);
  }

  private restoreOpenedSessions(): void {
    const sessions = [...this.opened].map((userLookup) => ({
      userLookup,
      generation: this.sessionGeneration.get(userLookup) ?? 0
    }));
    for (const { userLookup } of sessions) {
      this.cancelSessionRestoreRetry(userLookup);
      this.opened.delete(userLookup);
    }
    void Promise.all(sessions.map(async ({
      userLookup,
      generation
    }) => {
      const opening = this.opening.get(userLookup);
      if (opening !== undefined) {
        await opening.catch(() => undefined);
      }
      if (
        this.loggingOut.has(userLookup)
        || (this.sessionGeneration.get(userLookup) ?? 0) !== generation
      ) {
        return false;
      }
      try {
        await this.ensureSession(userLookup);
        this.restoreRetryAttempts.delete(userLookup);
      } catch (error: unknown) {
        if (
          !this.loggingOut.has(userLookup)
          && (this.sessionGeneration.get(userLookup) ?? 0) === generation
        ) {
          // Keep the session desired even though the worker-side copy is
          // currently missing. A request can recover it immediately, while
          // the timer restores background notifications without user action.
          this.opened.add(userLookup);
          this.options.onSessionRecoveryError?.(error);
          this.scheduleSessionRestoreRetry(userLookup, generation);
        }
      }
    }));
  }

  private scheduleSessionRestoreRetry(
    userLookup: string,
    generation: number
  ): void {
    if (this.restoreRetryTimers.has(userLookup)) {
      return;
    }
    const attempt = (this.restoreRetryAttempts.get(userLookup) ?? 0) + 1;
    this.restoreRetryAttempts.set(userLookup, attempt);
    const delayMs = Math.min(30_000, 500 * (2 ** Math.min(attempt - 1, 6)));
    const timer = setTimeout(() => {
      this.restoreRetryTimers.delete(userLookup);
      if (
        this.loggingOut.has(userLookup)
        || (this.sessionGeneration.get(userLookup) ?? 0) !== generation
        || !this.opened.delete(userLookup)
      ) {
        return;
      }
      void this.ensureSession(userLookup).then(
        () => {
          this.restoreRetryAttempts.delete(userLookup);
        },
        (error: unknown) => {
          if (
            !this.loggingOut.has(userLookup)
            && (this.sessionGeneration.get(userLookup) ?? 0) === generation
          ) {
            this.opened.add(userLookup);
            this.options.onSessionRecoveryError?.(error);
            this.scheduleSessionRestoreRetry(userLookup, generation);
          }
        }
      );
    }, delayMs);
    timer.unref();
    this.restoreRetryTimers.set(userLookup, timer);
  }

  private cancelSessionRestoreRetry(userLookup: string): void {
    const timer = this.restoreRetryTimers.get(userLookup);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.restoreRetryTimers.delete(userLookup);
    }
    this.restoreRetryAttempts.delete(userLookup);
  }

  private async openSession(userLookup: string): Promise<void> {
    const generation = this.sessionGeneration.get(userLookup) ?? 0;
    const storageState = await this.options.users.loadMaxSessionByLookup(
      userLookup
    );
    try {
      await this.options.worker.request({
        operation: "session.open",
        sessionHandle: sessionHandle(userLookup),
        ...(storageState === null ? {} : {
          payload: {
            storageStateBase64: Buffer.from(storageState).toString("base64")
          }
        })
      });
      if (
        (this.sessionGeneration.get(userLookup) ?? 0) === generation
        && !this.loggingOut.has(userLookup)
      ) {
        this.revokedSessions.delete(userLookup);
        this.opened.add(userLookup);
      }
    } finally {
      if (storageState !== null) {
        zeroBuffer(storageState);
      }
    }
  }

  private async requestWithSessionRecovery(
    userLookup: string,
    request: WorkerClientRequest
  ): Promise<unknown> {
    const generation = this.sessionGeneration.get(userLookup) ?? 0;
    if (this.loggingOut.has(userLookup) || !this.opened.has(userLookup)) {
      throw new Error("Session lifecycle changed");
    }
    try {
      const response = await this.options.worker.request(request);
      if (
        this.loggingOut.has(userLookup)
        || (this.sessionGeneration.get(userLookup) ?? 0) !== generation
      ) {
        throw new Error("Session lifecycle changed");
      }
      return response;
    } catch (error) {
      if (
        !(error instanceof WorkerRequestError)
        || error.code !== "session_not_found"
      ) {
        throw error;
      }
      // The worker keeps sessions in memory, while the API caches which
      // handles it has opened. An independent worker restart invalidates the
      // worker-side session without clearing this API-side cache.
      if (
        this.loggingOut.has(userLookup)
        || (this.sessionGeneration.get(userLookup) ?? 0) !== generation
      ) {
        throw new Error("Session lifecycle changed", { cause: error });
      }
      this.opened.delete(userLookup);
      await this.ensureSession(userLookup);
      if (
        (this.sessionGeneration.get(userLookup) ?? 0) !== generation
        || this.loggingOut.has(userLookup)
        || !this.opened.has(userLookup)
      ) {
        throw new Error("Session lifecycle changed", { cause: error });
      }
      const response = await this.options.worker.request(request);
      if (
        this.loggingOut.has(userLookup)
        || (this.sessionGeneration.get(userLookup) ?? 0) !== generation
        || !this.opened.has(userLookup)
      ) {
        throw new Error("Session lifecycle changed", { cause: error });
      }
      return response;
    }
  }

  private persistAuthenticatedSession(
    userLookup: string,
    storageState: Uint8Array,
    generation: number
  ): Promise<void> {
    if (
      this.loggingOut.has(userLookup)
      || (this.sessionGeneration.get(userLookup) ?? 0) !== generation
    ) {
      return Promise.reject(new Error("Session lifecycle changed"));
    }
    const writes = this.sessionWrites.get(userLookup) ?? new Set();
    this.sessionWrites.set(userLookup, writes);
    const operation = (async () => {
      await this.options.users.saveMaxSessionByLookup(
        userLookup,
        storageState
      );
      if (
        this.loggingOut.has(userLookup)
        || (this.sessionGeneration.get(userLookup) ?? 0) !== generation
      ) {
        throw new Error("Session lifecycle changed");
      }
      const state = this.options.users.findUserByLookup(userLookup)?.state;
      if (state === "authenticating") {
        this.options.users.transitionByLookup(userLookup, "active");
      }
    })();
    const tracked = operation.finally(() => {
      writes.delete(tracked);
      if (writes.size === 0) {
        this.sessionWrites.delete(userLookup);
      }
    });
    writes.add(tracked);
    return tracked;
  }

  private drainPendingWorkerClose(userLookup: string): Promise<void> {
    if (!this.pendingWorkerCloses.has(userLookup)) {
      return Promise.resolve();
    }
    const existing = this.workerClosing.get(userLookup);
    if (existing !== undefined) {
      return existing;
    }
    const operation = this.options.worker.request({
      operation: "session.close",
      sessionHandle: sessionHandle(userLookup)
    }).then(
      () => {
        this.pendingWorkerCloses.delete(userLookup);
      },
      (error: unknown) => {
        if (
          error instanceof WorkerRequestError
          && error.code === "session_not_found"
        ) {
          this.pendingWorkerCloses.delete(userLookup);
          return;
        }
        throw error;
      }
    );
    const tracked = operation.finally(() => {
      if (this.workerClosing.get(userLookup) === tracked) {
        this.workerClosing.delete(userLookup);
      }
    });
    this.workerClosing.set(userLookup, tracked);
    return tracked;
  }

  private retryPendingWorkerCloses(): void {
    for (const userLookup of this.pendingWorkerCloses) {
      void this.drainPendingWorkerClose(userLookup).catch(
        (error: unknown) => {
          this.options.onSessionRecoveryError?.(error);
        }
      );
    }
  }

  private beginAuthentication(userLookup: string): void {
    const state = this.options.users.findUserByLookup(userLookup)?.state;
    if (state === "approved_unbound" || state === "reauth_required") {
      this.options.users.transitionByLookup(userLookup, "authenticating");
    }
  }

  private handleWorkerEvent(event: WorkerEvent): void {
    if (event.event !== "session.event" || event.payload === undefined) {
      return;
    }
    const userLookup = userLookupFromHandle(event.sessionHandle);
    if (
      userLookup === undefined
      || this.revokedSessions.has(userLookup)
    ) {
      return;
    }
    let parsed: BridgeEvent;
    try {
      parsed = parseBridgeEvent(event.payload);
    } catch {
      return;
    }
    for (const listener of this.globalListeners) {
      listener(userLookup, parsed);
    }
    for (const listener of this.listeners.get(userLookup) ?? []) {
      listener(parsed);
    }
  }
}

function sessionHandle(userLookup: string): string {
  if (!/^u_[A-Za-z0-9_-]{22,64}$/u.test(userLookup)) {
    throw new TypeError("Invalid user lookup");
  }
  return `s_${userLookup.slice(2)}`;
}

function userLookupFromHandle(handle: string): string | undefined {
  return /^s_[A-Za-z0-9_-]{22,64}$/u.test(handle)
    ? `u_${handle.slice(2)}`
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw new TypeError("Worker response is invalid");
  }
  return value as Record<string, unknown>;
}

function parseLoginResult(value: unknown): MaxLoginResult {
  const state = record(value)["state"];
  if (
    state === "method_required"
    || state === "code_required"
    || state === "qr_required"
    || state === "authenticated"
    || state === "invalid_code"
    || state === "captcha_required"
    || state === "failed"
  ) {
    return { state };
  }
  throw new TypeError("MAX login result is invalid");
}

function parsePng(value: unknown, message: string): Buffer {
  if (
    typeof value !== "string"
    || value.length < 4
    || value.length > 4 * 1024 * 1024
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new TypeError(message);
  }
  return Buffer.from(value, "base64");
}

function parseSendResult(value: unknown): MessageRouteResult {
  const result = record(value);
  const state = result["state"];
  const operationId = result["operationId"];
  const messageId = result["messageId"];
  if (
    (state !== "confirmed" && state !== "ambiguous")
    || typeof operationId !== "string"
    || (
      messageId !== undefined
      && typeof messageId !== "string"
    )
  ) {
    throw new TypeError("MAX send result is invalid");
  }
  return {
    state,
    operationId,
    ...(messageId === undefined ? {} : { messageId })
  };
}
