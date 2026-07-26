import {
  parseBridgeEvent,
  parseChatSummary,
  parseMessage,
  zeroBuffer,
  type BridgeEvent,
  type ChatSummary,
  type Message,
  type UserRecord,
  type UserState
} from "@maxbridge/core";
import type { MaxLoginResult } from "@maxbridge/max-adapter";
import type {
  WorkerClientRequest
} from "../worker/worker-client.js";
import type { WorkerEvent } from "@maxbridge/protocol";

import type { ChatGateway } from "../routes/chats.js";
import type {
  CaptchaPointerInput,
  MaxLoginGateway
} from "../routes/max-login.js";
import type {
  MessageGateway,
  MessageRouteResult
} from "../routes/messages.js";
import type { LiveGateway } from "../routes/websocket.js";

export interface RuntimeWorker {
  request(request: WorkerClientRequest): Promise<unknown>;
  subscribe(listener: (event: WorkerEvent) => void): () => void;
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

export class BridgeRuntimeGateway implements
  ChatGateway,
  MaxLoginGateway,
  MessageGateway,
  LiveGateway {
  private readonly opened = new Set<string>();
  private readonly opening = new Map<string, Promise<void>>();
  private readonly listeners = new Map<
    string,
    Set<(event: BridgeEvent) => void>
  >();

  constructor(private readonly options: Readonly<{
    worker: RuntimeWorker;
    users: RuntimeUsers;
  }>) {
    options.worker.subscribe((event) => {
      this.handleWorkerEvent(event);
    });
  }

  async submitPhone(
    userLookup: string,
    phone: Uint8Array
  ): Promise<MaxLoginResult> {
    await this.ensureSession(userLookup);
    this.beginAuthentication(userLookup);
    return parseLoginResult(await this.options.worker.request({
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
    this.beginAuthentication(userLookup);
    const response = record(await this.options.worker.request({
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
      await this.options.users.saveMaxSessionByLookup(
        userLookup,
        storageState
      );
    } finally {
      zeroBuffer(storageState);
    }
    const state = this.options.users.findUserByLookup(userLookup)?.state;
    if (state === "authenticating") {
      this.options.users.transitionByLookup(userLookup, "active");
    }
    return result;
  }

  async getQrPng(userLookup: string): Promise<Buffer> {
    await this.ensureSession(userLookup);
    this.beginAuthentication(userLookup);
    const response = record(await this.options.worker.request({
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
    const response = record(await this.options.worker.request({
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
    return parseLoginResult(await this.options.worker.request({
      operation: "login.captcha.pointer",
      sessionHandle: sessionHandle(userLookup),
      payload: input
    }));
  }

  async status(userLookup: string): Promise<MaxLoginResult> {
    await this.ensureSession(userLookup);
    return parseLoginResult(await this.options.worker.request({
      operation: "login.status",
      sessionHandle: sessionHandle(userLookup)
    }));
  }

  async logout(userLookup: string): Promise<void> {
    const handle = sessionHandle(userLookup);
    if (this.opened.has(userLookup)) {
      await this.options.worker.request({
        operation: "session.close",
        sessionHandle: handle
      });
    }
    this.opened.delete(userLookup);
    this.options.users.clearMaxSessionByLookup(userLookup);
    const state = this.options.users.findUserByLookup(userLookup)?.state;
    if (state === "active") {
      this.options.users.transitionByLookup(userLookup, "reauth_required");
    }
  }

  async list(userLookup: string): Promise<readonly ChatSummary[]> {
    await this.ensureSession(userLookup);
    const response = record(await this.options.worker.request({
      operation: "chats.list",
      sessionHandle: sessionHandle(userLookup)
    }));
    const chats = response["chats"];
    if (!Array.isArray(chats)) {
      throw new TypeError("MAX chat list is invalid");
    }
    return chats.map(parseChatSummary);
  }

  async history(
    userLookup: string,
    chatId: string,
    cursor?: string
  ): Promise<readonly Message[] | null> {
    await this.ensureSession(userLookup);
    const response = record(await this.options.worker.request({
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
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.options.worker.request({
      operation: "message.send",
      sessionHandle: sessionHandle(userLookup),
      payload: {
        chatId: input.chatId,
        clientRequestId: input.clientRequestId,
        text: new TextDecoder().decode(input.text)
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
      confirmedByUser: true;
    }>
  ): Promise<MessageRouteResult> {
    await this.ensureSession(userLookup);
    return parseSendResult(await this.options.worker.request({
      operation: "message.send",
      sessionHandle: sessionHandle(userLookup),
      payload: {
        chatId: input.chatId,
        clientRequestId: input.clientRequestId,
        text: new TextDecoder().decode(input.text),
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
    return parseSendResult(await this.options.worker.request({
      operation: "message.sendAttachment",
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
    const listeners = this.listeners.get(userLookup) ?? new Set();
    listeners.add(listener);
    this.listeners.set(userLookup, listeners);
    void this.ensureSession(userLookup).catch(() => undefined);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(userLookup);
      }
    };
  }

  private ensureSession(userLookup: string): Promise<void> {
    if (this.opened.has(userLookup)) {
      return Promise.resolve();
    }
    const existing = this.opening.get(userLookup);
    if (existing !== undefined) {
      return existing;
    }
    const opening = this.openSession(userLookup).finally(() => {
      this.opening.delete(userLookup);
    });
    this.opening.set(userLookup, opening);
    return opening;
  }

  private async openSession(userLookup: string): Promise<void> {
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
      this.opened.add(userLookup);
    } finally {
      if (storageState !== null) {
        zeroBuffer(storageState);
      }
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
    if (userLookup === undefined) {
      return;
    }
    let parsed: BridgeEvent;
    try {
      parsed = parseBridgeEvent(event.payload);
    } catch {
      return;
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
