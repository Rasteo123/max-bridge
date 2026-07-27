import { zeroBuffer } from "@maxbridge/core";
import type {
  BridgeEvent,
  ChatAction,
  ChatSummary,
  Message,
  ReactionKey,
  StickerSummary
} from "@maxbridge/core";
import type { MaxLoginResult } from "@maxbridge/max-adapter";
import type {
  WorkerRequest,
  WorkerResponse
} from "@maxbridge/protocol";

export interface RuntimeMaxSession {
  submitPhone(phone: string): Promise<MaxLoginResult>;
  submitCode(code: string): Promise<Readonly<{
    result: MaxLoginResult;
    storageStateBase64?: string;
  }>>;
  getQrPng(): Promise<Buffer>;
  getCaptchaPng(): Promise<Buffer>;
  sendCaptchaPointer(input: CaptchaPointerInput): Promise<MaxLoginResult>;
  status(): Promise<MaxLoginResult>;
  background(): Promise<void>;
  listChats(): Promise<readonly ChatSummary[]>;
  history(chatId: string): Promise<readonly Message[] | null>;
  sendText(
    chatId: string,
    text: string,
    replyToId?: string
  ): Promise<RuntimeMutationResult>;
  editMessage(
    chatId: string,
    messageId: string,
    text: string
  ): Promise<RuntimeMutationResult>;
  deleteMessage(
    chatId: string,
    messageId: string
  ): Promise<RuntimeMutationResult>;
  setReaction(
    chatId: string,
    messageId: string,
    reaction: ReactionKey | null
  ): Promise<RuntimeMutationResult>;
  chatAction(
    chatId: string,
    action: ChatAction
  ): Promise<RuntimeMutationResult>;
  listStickers(chatId: string): Promise<readonly StickerSummary[]>;
  sendSticker(
    chatId: string,
    stickerId: string
  ): Promise<RuntimeMutationResult>;
  sendAttachment?(input: Readonly<{
    chatId: string;
    filePath: string;
    kind: "media" | "file";
  }>): Promise<RuntimeMutationResult>;
  close(): Promise<void>;
}

export type RuntimeMutationResult = Readonly<{
  state: "confirmed" | "ambiguous";
  operationId: string;
  messageId?: string;
}>;

export type CaptchaPointerInput = Readonly<{
  phase: "down" | "move" | "up";
  x: number;
  y: number;
}>;

export interface RuntimeSessionFactory {
  open(
    handle: string,
    storageState: Uint8Array | undefined,
    onEvents: (events: readonly BridgeEvent[]) => void
  ): Promise<RuntimeMaxSession>;
  close(handle: string, session: RuntimeMaxSession): Promise<void>;
}

export class WorkerRuntimeRequestHandler {
  private readonly sessions = new Map<string, RuntimeMaxSession>();
  private readonly operationQueues = new Map<string, Promise<void>>();

  constructor(private readonly options: Readonly<{
    factory: RuntimeSessionFactory;
    healthy: () => boolean;
    emitEvents?: (
      sessionHandle: string,
      events: readonly BridgeEvent[]
    ) => void;
  }>) {}

  readonly handle = (
    request: WorkerRequest
  ): Promise<WorkerResponse> => {
    const previous = this.operationQueues.get(request.sessionHandle)
      ?? Promise.resolve();
    const operation = previous.then(() => this.handleNow(request));
    const settled = operation.then(
      () => undefined,
      () => undefined
    );
    this.operationQueues.set(request.sessionHandle, settled);
    void settled.finally(() => {
      if (this.operationQueues.get(request.sessionHandle) === settled) {
        this.operationQueues.delete(request.sessionHandle);
      }
    });
    return operation;
  };

  private async handleNow(
    request: WorkerRequest
  ): Promise<WorkerResponse> {
    try {
      if (request.operation === "health.check") {
        return success(request, { healthy: this.options.healthy() });
      }
      if (request.operation === "session.open") {
        return await this.open(request);
      }
      if (request.operation === "session.close") {
        await this.closeSession(request.sessionHandle);
        return success(request);
      }
      const session = this.sessions.get(request.sessionHandle);
      if (session === undefined) {
        return failure(request, "session_not_found");
      }
      switch (request.operation) {
        case "session.background":
          await session.background();
          return success(request, { background: true });
        case "login.phone":
          return success(
            request,
            await session.submitPhone(readPhone(request.payload))
          );
        case "login.code":
          return success(
            request,
            await session.submitCode(readCode(request.payload))
          );
        case "login.qr":
          return success(request, {
            pngBase64: (await session.getQrPng()).toString("base64")
          });
        case "login.captcha.frame":
          return success(request, {
            pngBase64: (await session.getCaptchaPng()).toString("base64")
          });
        case "login.captcha.pointer":
          return success(
            request,
            await session.sendCaptchaPointer(
              readCaptchaPointer(request.payload)
            )
          );
        case "login.status":
          return success(request, await session.status());
        case "chats.list":
          return success(request, { chats: await session.listChats() });
        case "messages.history":
          return success(request, {
            messages: await session.history(readChatId(request.payload))
          });
        case "message.send": {
          const input = readSendText(request.payload);
          return success(
            request,
            await session.sendText(
              input.chatId,
              input.text,
              input.replyToId
            )
          );
        }
        case "message.sendAttachment": {
          const input = readSendAttachment(request.payload);
          if (session.sendAttachment === undefined) {
            return failure(request, "invalid_request");
          }
          return success(
            request,
            await session.sendAttachment(input)
          );
        }
        case "message.edit": {
          const input = readEditMessage(request.payload);
          return success(
            request,
            await session.editMessage(
              input.chatId,
              input.messageId,
              input.text
            )
          );
        }
        case "message.delete": {
          const input = readDeleteMessage(request.payload);
          return success(
            request,
            await session.deleteMessage(input.chatId, input.messageId)
          );
        }
        case "message.reaction.set": {
          const input = readSetReaction(request.payload);
          return success(
            request,
            await session.setReaction(
              input.chatId,
              input.messageId,
              input.reaction
            )
          );
        }
        case "chat.action": {
          const input = readChatAction(request.payload);
          return success(
            request,
            await session.chatAction(input.chatId, input.action)
          );
        }
        case "stickers.list":
          return success(request, {
            stickers: await session.listStickers(
              readOnlyChatId(request.payload)
            )
          });
        case "sticker.send": {
          const input = readSendSticker(request.payload);
          return success(
            request,
            await session.sendSticker(input.chatId, input.stickerId)
          );
        }
        default:
          return failure(request, "invalid_request");
      }
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        event: "max_worker_operation_failed",
        operation: request.operation,
        category: classifyWorkerError(error)
      })}\n`);
      return failure(request, "worker_failure");
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.sessions].map(
      async ([handle, session]) => {
        await this.options.factory.close(handle, session);
      }
    ));
    this.sessions.clear();
    this.operationQueues.clear();
  }

  private async open(request: WorkerRequest): Promise<WorkerResponse> {
    if (this.sessions.has(request.sessionHandle)) {
      return success(request, { opened: true });
    }
    const storageState = readStorageState(request.payload);
    try {
      const session = await this.options.factory.open(
        request.sessionHandle,
        storageState,
        (events) => {
          this.options.emitEvents?.(request.sessionHandle, events);
        }
      );
      this.sessions.set(request.sessionHandle, session);
      return success(request, { opened: true });
    } finally {
      if (storageState !== undefined) {
        zeroBuffer(storageState);
      }
    }
  }

  private async closeSession(handle: string): Promise<void> {
    const session = this.sessions.get(handle);
    this.sessions.delete(handle);
    if (session !== undefined) {
      await this.options.factory.close(handle, session);
    }
  }
}

function success(
  request: WorkerRequest,
  payload?: unknown
): WorkerResponse {
  return {
    kind: "response",
    requestId: request.requestId,
    ok: true,
    ...(payload === undefined ? {} : { payload })
  };
}

function failure(
  request: WorkerRequest,
  errorCode: "invalid_request" | "session_not_found" | "worker_failure"
): WorkerResponse {
  return {
    kind: "response",
    requestId: request.requestId,
    ok: false,
    errorCode
  };
}

function classifyWorkerError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown";
  }
  if (error.name === "TimeoutError") {
    return "browser_timeout";
  }
  if (error.message === "MAX session is not authenticated") {
    return "max_session_unavailable";
  }
  if (error.message === "binding") {
    return "max_binding_unavailable";
  }
  if (error.message === "node module") {
    return "max_node_module_unavailable";
  }
  if (error instanceof TypeError) {
    return "invalid_operation_data";
  }
  return "unexpected";
}

function record(value: unknown): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return value as Record<string, unknown>;
}

function exact(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  const parsed = record(value);
  if (Object.keys(parsed).some((key) => !keys.includes(key))) {
    throw new TypeError("Invalid worker payload");
  }
  return parsed;
}

function readStorageState(value: unknown): Uint8Array | undefined {
  if (value === undefined) {
    return undefined;
  }
  const input = exact(value, ["storageStateBase64"]);
  const encoded = input["storageStateBase64"];
  if (
    typeof encoded !== "string"
    || encoded.length < 4
    || encoded.length > 2 * 1024 * 1024
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return Buffer.from(encoded, "base64");
}

function readPhone(value: unknown): string {
  const phone = exact(value, ["phone"])["phone"];
  if (typeof phone !== "string" || !/^\+[1-9]\d{7,14}$/u.test(phone)) {
    throw new TypeError("Invalid worker payload");
  }
  return phone;
}

function readCode(value: unknown): string {
  const code = exact(value, ["code"])["code"];
  if (typeof code !== "string" || !/^\d{4,8}$/u.test(code)) {
    throw new TypeError("Invalid worker payload");
  }
  return code;
}

function readCaptchaPointer(value: unknown): CaptchaPointerInput {
  const input = exact(value, ["phase", "x", "y"]);
  const phase = input["phase"];
  const x = input["x"];
  const y = input["y"];
  if (
    (phase !== "down" && phase !== "move" && phase !== "up")
    || typeof x !== "number"
    || !Number.isFinite(x)
    || x < 0
    || x > 1
    || typeof y !== "number"
    || !Number.isFinite(y)
    || y < 0
    || y > 1
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return { phase, x, y };
}

function readChatId(value: unknown): string {
  const chatId = exact(value, ["chatId", "cursor"])["chatId"];
  if (
    typeof chatId !== "string"
    || chatId.length < 1
    || chatId.length > 512
    || hasControlCharacter(chatId)
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return chatId;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function readSendText(value: unknown): Readonly<{
  chatId: string;
  text: string;
  replyToId?: string;
}> {
  const input = exact(value, [
    "chatId",
    "clientRequestId",
    "text",
    "replyToId",
    "retryOf",
    "confirmedByUser"
  ]);
  const chatId = readChatId({ chatId: input["chatId"] });
  const text = input["text"];
  readClientRequestId(input["clientRequestId"]);
  const replyToId = optionalOpaqueId(input["replyToId"]);
  const retryOf = input["retryOf"];
  const confirmedByUser = input["confirmedByUser"];
  if (retryOf === undefined) {
    if (confirmedByUser !== undefined) {
      throw new TypeError("Invalid worker payload");
    }
  } else {
    readClientRequestId(retryOf);
    if (confirmedByUser !== true) {
      throw new TypeError("Invalid worker payload");
    }
  }
  if (
    typeof text !== "string"
    || text.length < 1
    || text.length > 65_536
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return {
    chatId,
    text,
    ...(replyToId === undefined ? {} : { replyToId })
  };
}

function readSendAttachment(value: unknown): Readonly<{
  chatId: string;
  filePath: string;
  kind: "media" | "file";
}> {
  const input = exact(value, [
    "chatId",
    "clientRequestId",
    "filePath",
    "kind"
  ]);
  const chatId = readChatId({ chatId: input["chatId"] });
  const filePath = input["filePath"];
  const kind = input["kind"];
  readClientRequestId(input["clientRequestId"]);
  if (
    typeof filePath !== "string"
    || !filePath.startsWith("/run/maxbridge/media/")
    || filePath.length > 512
    || hasControlCharacter(filePath)
    || (kind !== "media" && kind !== "file")
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return { chatId, filePath, kind };
}

function readEditMessage(value: unknown): Readonly<{
  chatId: string;
  messageId: string;
  text: string;
}> {
  const input = exact(value, [
    "chatId",
    "messageId",
    "clientRequestId",
    "text"
  ]);
  const text = input["text"];
  if (
    typeof text !== "string"
    || text.length < 1
    || text.length > 65_536
  ) {
    throw new TypeError("Invalid worker payload");
  }
  readClientRequestId(input["clientRequestId"]);
  return {
    chatId: readChatId({ chatId: input["chatId"] }),
    messageId: readOpaqueId(input["messageId"]),
    text
  };
}

function readDeleteMessage(value: unknown): Readonly<{
  chatId: string;
  messageId: string;
}> {
  const input = exact(value, [
    "chatId",
    "messageId",
    "clientRequestId",
    "confirmedByUser"
  ]);
  readClientRequestId(input["clientRequestId"]);
  if (input["confirmedByUser"] !== true) {
    throw new TypeError("Invalid worker payload");
  }
  return {
    chatId: readChatId({ chatId: input["chatId"] }),
    messageId: readOpaqueId(input["messageId"])
  };
}

function readSetReaction(value: unknown): Readonly<{
  chatId: string;
  messageId: string;
  reaction: ReactionKey | null;
}> {
  const input = exact(value, [
    "chatId",
    "messageId",
    "clientRequestId",
    "reaction"
  ]);
  readClientRequestId(input["clientRequestId"]);
  const reaction = readReaction(input["reaction"]);
  return {
    chatId: readChatId({ chatId: input["chatId"] }),
    messageId: readOpaqueId(input["messageId"]),
    reaction
  };
}

function readChatAction(value: unknown): Readonly<{
  chatId: string;
  action: ChatAction;
}> {
  const input = exact(value, [
    "chatId",
    "clientRequestId",
    "action",
    "confirmedByUser"
  ]);
  readClientRequestId(input["clientRequestId"]);
  const action = readAction(input["action"]);
  if (
    (action === "clear" || action === "delete")
    && input["confirmedByUser"] !== true
  ) {
    throw new TypeError("Invalid worker payload");
  }
  if (
    input["confirmedByUser"] !== undefined
    && typeof input["confirmedByUser"] !== "boolean"
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return {
    chatId: readChatId({ chatId: input["chatId"] }),
    action
  };
}

function readClientRequestId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 128
    || hasControlCharacter(value)
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return value;
}

function readOpaqueId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 512
    || hasControlCharacter(value)
  ) {
    throw new TypeError("Invalid worker payload");
  }
  return value;
}

function optionalOpaqueId(value: unknown): string | undefined {
  return value === undefined ? undefined : readOpaqueId(value);
}

function readReaction(value: unknown): ReactionKey | null {
  if (
    value === null
    || value === "like"
    || value === "heart"
    || value === "laugh"
    || value === "fire"
    || value === "cry"
    || value === "celebrate"
  ) {
    return value;
  }
  throw new TypeError("Invalid worker payload");
}

function readAction(value: unknown): ChatAction {
  if (
    value === "pin"
    || value === "unpin"
    || value === "mark_unread"
    || value === "mute"
    || value === "unmute"
    || value === "clear"
    || value === "delete"
  ) {
    return value;
  }
  throw new TypeError("Invalid worker payload");
}

function readSendSticker(value: unknown): Readonly<{
  chatId: string;
  stickerId: string;
}> {
  const input = exact(value, [
    "chatId",
    "stickerId",
    "clientRequestId"
  ]);
  readClientRequestId(input["clientRequestId"]);
  return {
    chatId: readChatId({ chatId: input["chatId"] }),
    stickerId: readOpaqueId(input["stickerId"])
  };
}

function readOnlyChatId(value: unknown): string {
  const input = exact(value, ["chatId"]);
  return readChatId({ chatId: input["chatId"] });
}
