import { randomBytes } from "node:crypto";

export type MaxSendCommand = Readonly<{
  opcode: 64;
  payload: Readonly<{
    chatId: string;
    message: Readonly<{
      text?: string;
      cid: string;
      elements?: readonly unknown[];
      attaches: readonly MaxPreparedAttachment[];
    }>;
    notify: true;
  }>;
}>;

export type MaxPreparedAttachment =
  | Readonly<{ _type: "PHOTO"; photoToken: string }>
  | Readonly<{ _type: "VIDEO"; videoToken: string }>
  | Readonly<{ _type: "AUDIO"; audioToken: string }>
  | Readonly<{
    _type: "FILE";
    fileToken: string;
    fileName?: string;
  }>;

export interface MaxSendTransport {
  send(command: MaxSendCommand): Promise<Readonly<{
    messageId?: string;
  }>>;
}

export type MaxSendFailurePhase =
  | "before_write"
  | "after_write"
  | "before_confirmation";

export class MaxSendTransportError extends Error {
  readonly code = "max_send_transport_failed";

  constructor(readonly phase: MaxSendFailurePhase) {
    super("MAX transport did not confirm the send");
    this.name = "MaxSendTransportError";
  }
}

export class SendControllerError extends Error {
  constructor(readonly code:
    | "invalid_message"
    | "retry_confirmation_required"
    | "retry_not_ambiguous"
    | "message_send_failed"
  ) {
    super("Message could not be sent");
    this.name = "SendControllerError";
  }
}

export type SendResult =
  | Readonly<{
    state: "confirmed";
    operationId: string;
    messageId?: string;
  }>
  | Readonly<{
    state: "ambiguous";
    operationId: string;
  }>;

export type SendTextInput = Readonly<{
  clientRequestId: string;
  chatId: string;
  text: string;
}>;

export type SendMediaInput = Readonly<{
  clientRequestId: string;
  chatId: string;
  text?: string;
  media: Readonly<{
    kind: "image" | "video" | "voice" | "file";
    token: string;
    mimeType: string;
    size: number;
    fileName?: string;
  }>;
}>;

export class SendController {
  private readonly operations = new Map<string, SendResult>();
  private readonly maxOperations: number;
  private readonly operationId: () => string;

  constructor(private readonly options: Readonly<{
    transport: MaxSendTransport;
    operationId?: () => string;
    maxOperations?: number;
  }>) {
    this.operationId = options.operationId ?? createOperationId;
    this.maxOperations = Math.max(1, options.maxOperations ?? 1_000);
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const existing = this.operations.get(input.clientRequestId);
    if (existing !== undefined) {
      return existing;
    }
    validateSendInput(input);
    const operationId = this.operationId();
    const command: MaxSendCommand = {
      opcode: 64,
      payload: {
        chatId: input.chatId,
        message: {
          text: input.text,
          cid: operationId,
          elements: [],
          attaches: []
        },
        notify: true
      }
    };
    const result = await this.sendCommand(command, operationId);
    this.remember(input.clientRequestId, result);
    return result;
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const existing = this.operations.get(input.clientRequestId);
    if (existing !== undefined) {
      return existing;
    }
    validateBaseInput(input);
    validatePreparedMedia(input);
    const operationId = this.operationId();
    const attachment = preparedAttachment(input.media);
    const command: MaxSendCommand = {
      opcode: 64,
      payload: {
        chatId: input.chatId,
        message: {
          ...(input.text === undefined || input.text.length === 0
            ? {}
            : { text: input.text }),
          cid: operationId,
          elements: [],
          attaches: [attachment]
        },
        notify: true
      }
    };
    const result = await this.sendCommand(command, operationId);
    this.remember(input.clientRequestId, result);
    return result;
  }

  async retryText(input: SendTextInput & Readonly<{
    retryOf: string;
    confirmedByUser: boolean;
  }>): Promise<SendResult> {
    if (!input.confirmedByUser) {
      throw new SendControllerError("retry_confirmation_required");
    }
    const prior = this.operations.get(input.retryOf);
    if (prior?.state !== "ambiguous") {
      throw new SendControllerError("retry_not_ambiguous");
    }
    if (input.clientRequestId === input.retryOf) {
      throw new SendControllerError("invalid_message");
    }
    return this.sendText(input);
  }

  private async sendCommand(
    command: MaxSendCommand,
    operationId: string
  ): Promise<SendResult> {
    try {
      return confirmedResult(
        operationId,
        await this.options.transport.send(command)
      );
    } catch (error: unknown) {
      if (
        error instanceof MaxSendTransportError
        && error.phase === "before_write"
      ) {
        try {
          return confirmedResult(
            operationId,
            await this.options.transport.send(command)
          );
        } catch (retryError: unknown) {
          return this.handleSendFailure(retryError, operationId);
        }
      }
      return this.handleSendFailure(error, operationId);
    }
  }

  private handleSendFailure(
    error: unknown,
    operationId: string
  ): SendResult {
    if (
      error instanceof MaxSendTransportError
      && (
        error.phase === "after_write"
        || error.phase === "before_confirmation"
      )
    ) {
      return { state: "ambiguous", operationId };
    }
    throw new SendControllerError("message_send_failed");
  }

  private remember(clientRequestId: string, result: SendResult): void {
    this.operations.set(clientRequestId, result);
    while (this.operations.size > this.maxOperations) {
      const oldest = this.operations.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.operations.delete(oldest);
    }
  }
}

function confirmedResult(
  operationId: string,
  confirmation: Readonly<{ messageId?: string }>
): SendResult {
  return {
    state: "confirmed",
    operationId,
    ...(confirmation.messageId === undefined
      ? {}
      : { messageId: confirmation.messageId })
  };
}

function validateSendInput(input: SendTextInput): void {
  if (
    input.text.length < 1
    || input.text.length > 65_536
  ) {
    throw new SendControllerError("invalid_message");
  }
  validateBaseInput(input);
}

function validateBaseInput(input: Readonly<{
  chatId: string;
  clientRequestId: string;
}>): void {
  if (
    input.chatId.length < 1
    || input.chatId.length > 512
    || input.clientRequestId.length < 1
    || input.clientRequestId.length > 128
    || hasControl(input.chatId)
    || hasControl(input.clientRequestId)
  ) {
    throw new SendControllerError("invalid_message");
  }
}

function validatePreparedMedia(input: SendMediaInput): void {
  const { media } = input;
  const cap = media.kind === "image"
    ? 20 * 1024 * 1024
    : media.kind === "video"
      ? 100 * 1024 * 1024
      : 50 * 1024 * 1024;
  const expectedPrefix = media.kind === "image"
    ? "image/"
    : media.kind === "video"
      ? "video/"
      : media.kind === "voice"
        ? "audio/"
        : undefined;
  if (
    !Number.isSafeInteger(media.size)
    || media.size < 1
    || media.size > cap
    || media.token.length < 1
    || media.token.length > 4_096
    || hasControl(media.token)
    || (
      expectedPrefix !== undefined
      && !media.mimeType.toLowerCase().startsWith(expectedPrefix)
    )
    || (input.text?.length ?? 0) > 65_536
  ) {
    throw new SendControllerError("invalid_message");
  }
}

function preparedAttachment(
  media: SendMediaInput["media"]
): MaxPreparedAttachment {
  switch (media.kind) {
    case "image":
      return { _type: "PHOTO", photoToken: media.token };
    case "video":
      return { _type: "VIDEO", videoToken: media.token };
    case "voice":
      return { _type: "AUDIO", audioToken: media.token };
    case "file":
      return {
        _type: "FILE",
        fileToken: media.token,
        ...(media.fileName === undefined
          ? {}
          : { fileName: normalizeFileName(media.fileName) })
      };
  }
}

function normalizeFileName(value: string): string {
  const leaf = value.split(/[/\\]/u).at(-1) ?? "file";
  let clean = "";
  for (let index = 0; index < leaf.length; index += 1) {
    const code = leaf.charCodeAt(index);
    if (code > 31 && code !== 127) {
      clean += leaf.charAt(index);
    }
  }
  return clean.trim().slice(0, 255) || "file";
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function createOperationId(): string {
  return randomBytes(16).toString("base64url");
}
