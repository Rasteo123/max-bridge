import type {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest
} from "fastify";

import {
  zeroBuffer,
  type ChatAction,
  type ReactionKey,
  type StickerSummary
} from "@maxbridge/core";

import {
  OriginPolicyError,
  assertAllowedOrigin
} from "../auth/origin-policy.js";
import type { SessionPrincipal } from "../auth/session-store.js";

export type MessageRouteResult =
  | Readonly<{
    state: "confirmed";
    operationId: string;
    messageId?: string;
  }>
  | Readonly<{
    state: "ambiguous";
    operationId: string;
  }>;

export interface MessageGateway {
  sendText(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      clientRequestId: string;
      text: Uint8Array;
      replyToId?: string;
    }>
  ): Promise<MessageRouteResult>;
  retryText(
    userLookup: string,
    input: Readonly<{
      retryOf: string;
      chatId: string;
      clientRequestId: string;
      text: Uint8Array;
      replyToId?: string;
      confirmedByUser: true;
    }>
  ): Promise<MessageRouteResult>;
  sendAttachment?(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      clientRequestId: string;
      filePath: string;
      kind: "media" | "file";
    }>
  ): Promise<MessageRouteResult>;
  editMessage(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      messageId: string;
      clientRequestId: string;
      text: Uint8Array;
    }>
  ): Promise<MessageRouteResult>;
  deleteMessage(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      messageId: string;
      clientRequestId: string;
      confirmedByUser: true;
    }>
  ): Promise<MessageRouteResult>;
  forwardMessage(
    userLookup: string,
    input: Readonly<{
      sourceChatId: string;
      sourceMessageId: string;
      destinationIds: readonly string[];
      clientRequestId: string;
    }>
  ): Promise<MessageRouteResult>;
  setReaction(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      messageId: string;
      clientRequestId: string;
      reaction: ReactionKey | null;
    }>
  ): Promise<MessageRouteResult>;
  chatAction(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      clientRequestId: string;
      action: ChatAction;
      confirmedByUser?: true;
    }>
  ): Promise<MessageRouteResult>;
  listStickers(
    userLookup: string,
    chatId: string
  ): Promise<readonly StickerSummary[]>;
  sendSticker(
    userLookup: string,
    input: Readonly<{
      chatId: string;
      stickerId: string;
      clientRequestId: string;
    }>
  ): Promise<MessageRouteResult>;
}

export type MessageRouteOptions = Readonly<{
  gateway: MessageGateway;
  allowedOrigins: ReadonlySet<string>;
  mediaRoot?: string;
  resolvePrincipal: (
    request: FastifyRequest
  ) => SessionPrincipal | null;
}>;

type TextBody = {
  kind: "text";
  chatId: string;
  clientRequestId: string;
  text: string;
  replyToId?: string;
};

type RetryBody = TextBody & {
  retryOf: string;
  confirmedByUser: boolean;
};

type AttachmentParams = { chatId: string };
type MessageParams = { chatId: string; messageId: string };
type StickerParams = { chatId: string; stickerId: string };
type EditMessageBody = {
  clientRequestId: string;
  text: string;
};
type DeleteMessageBody = {
  clientRequestId: string;
  confirmedByUser: boolean;
};
type ForwardMessageBody = {
  clientRequestId: string;
  destinationIds: string[];
};
type SetReactionBody = {
  clientRequestId: string;
  reaction: ReactionKey | null;
};
type ChatActionBody = {
  clientRequestId: string;
  action: ChatAction;
  confirmedByUser?: boolean;
};
type SendStickerBody = {
  clientRequestId: string;
};
type AttachmentQuery = {
  kind: "media" | "file";
  name: string;
  clientRequestId: string;
};

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DEFAULT_MEDIA_ROOT = "/run/maxbridge/media";

const commonTextProperties = {
  kind: { type: "string", const: "text" },
  chatId: { type: "string", minLength: 1, maxLength: 512 },
  clientRequestId: { type: "string", minLength: 1, maxLength: 128 },
  text: { type: "string", minLength: 1, maxLength: 65_536 },
  replyToId: { type: "string", minLength: 1, maxLength: 512 }
} as const;

const messageParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chatId", "messageId"],
  properties: {
    chatId: { type: "string", minLength: 1, maxLength: 512 },
    messageId: { type: "string", minLength: 1, maxLength: 512 }
  }
} as const;

const clientRequestIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128
} as const;

export const registerMessageRoutes: FastifyPluginCallback<
  MessageRouteOptions
> = (app, options, done) => {
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_ATTACHMENT_BYTES },
    (_request, body, next) => {
      next(null, body);
    }
  );

  app.post<{ Body: TextBody }>("/api/messages", {
    config: { sensitiveBody: true },
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "chatId",
          "clientRequestId",
          "text"
        ],
        properties: commonTextProperties
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    const text = new TextEncoder().encode(request.body.text);
    try {
      await reply.send(await options.gateway.sendText(
        principal.userLookup,
        {
          chatId: request.body.chatId,
          clientRequestId: request.body.clientRequestId,
          text,
          ...(request.body.replyToId === undefined
            ? {}
            : { replyToId: request.body.replyToId })
        }
      ));
    } finally {
      zeroBuffer(text);
    }
  });

  app.post<{ Body: RetryBody }>("/api/messages/retry", {
    config: { sensitiveBody: true },
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "retryOf",
          "chatId",
          "clientRequestId",
          "text",
          "confirmedByUser"
        ],
        properties: {
          ...commonTextProperties,
          retryOf: {
            type: "string",
            minLength: 1,
            maxLength: 128
          },
          confirmedByUser: { type: "boolean" }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    if (!request.body.confirmedByUser) {
      await reply.code(400).send({
        code: "retry_confirmation_required"
      });
      return;
    }
    const text = new TextEncoder().encode(request.body.text);
    try {
      await reply.send(await options.gateway.retryText(
        principal.userLookup,
        {
          retryOf: request.body.retryOf,
          chatId: request.body.chatId,
          clientRequestId: request.body.clientRequestId,
          text,
          ...(request.body.replyToId === undefined
            ? {}
            : { replyToId: request.body.replyToId }),
          confirmedByUser: true
        }
      ));
    } finally {
      zeroBuffer(text);
    }
  });

  app.post<{
    Params: AttachmentParams;
    Querystring: AttachmentQuery;
    Body: Buffer;
  }>("/api/chats/:chatId/attachments", {
    config: { sensitiveBody: true },
    bodyLimit: MAX_ATTACHMENT_BYTES,
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["chatId"],
        properties: {
          chatId: { type: "string", minLength: 1, maxLength: 512 }
        }
      },
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name", "clientRequestId"],
        properties: {
          kind: { type: "string", enum: ["media", "file"] },
          name: { type: "string", minLength: 1, maxLength: 255 },
          clientRequestId: {
            type: "string",
            minLength: 1,
            maxLength: 128
          }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    if (!Buffer.isBuffer(request.body) || request.body.length < 1) {
      await reply.code(400).send({ code: "attachment_empty" });
      return;
    }
    if (options.gateway.sendAttachment === undefined) {
      request.body.fill(0);
      await reply.code(501).send({ code: "attachment_unavailable" });
      return;
    }
    const safeName = safeAttachmentName(request.query.name);
    const mediaRoot = options.mediaRoot ?? DEFAULT_MEDIA_ROOT;
    await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(mediaRoot, "upload-"));
    const filePath = join(directory, safeName);
    try {
      await writeFile(filePath, request.body, {
        flag: "wx",
        mode: 0o600
      });
      await reply.send(await options.gateway.sendAttachment(
        principal.userLookup,
        {
          chatId: request.params.chatId,
          clientRequestId: request.query.clientRequestId,
          filePath,
          kind: request.query.kind
        }
      ));
    } finally {
      request.body.fill(0);
      await unlink(filePath).catch(() => undefined);
      await rmdir(directory).catch(() => undefined);
    }
  });

  app.patch<{
    Params: MessageParams;
    Body: EditMessageBody;
  }>("/api/chats/:chatId/messages/:messageId", {
    config: { sensitiveBody: true },
    schema: {
      params: messageParamsSchema,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["clientRequestId", "text"],
        properties: {
          clientRequestId: clientRequestIdSchema,
          text: {
            type: "string",
            minLength: 1,
            maxLength: 65_536
          }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    const text = new TextEncoder().encode(request.body.text);
    try {
      await reply.send(await options.gateway.editMessage(
        principal.userLookup,
        {
          chatId: request.params.chatId,
          messageId: request.params.messageId,
          clientRequestId: request.body.clientRequestId,
          text
        }
      ));
    } finally {
      zeroBuffer(text);
    }
  });

  app.post<{
    Params: MessageParams;
    Body: DeleteMessageBody;
  }>("/api/chats/:chatId/messages/:messageId/delete", {
    config: { sensitiveBody: true },
    schema: {
      params: messageParamsSchema,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["clientRequestId", "confirmedByUser"],
        properties: {
          clientRequestId: clientRequestIdSchema,
          confirmedByUser: { type: "boolean" }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    if (!request.body.confirmedByUser) {
      await reply.code(400).send({
        code: "delete_confirmation_required"
      });
      return;
    }
    await reply.send(await options.gateway.deleteMessage(
      principal.userLookup,
      {
        chatId: request.params.chatId,
        messageId: request.params.messageId,
        clientRequestId: request.body.clientRequestId,
        confirmedByUser: true
      }
    ));
  });

  app.post<{
    Params: MessageParams;
    Body: ForwardMessageBody;
  }>("/api/chats/:chatId/messages/:messageId/forward", {
    config: { sensitiveBody: true },
    schema: {
      params: messageParamsSchema,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["clientRequestId", "destinationIds"],
        properties: {
          clientRequestId: clientRequestIdSchema,
          destinationIds: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 512
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply.send(await options.gateway.forwardMessage(
      principal.userLookup,
      {
        sourceChatId: request.params.chatId,
        sourceMessageId: request.params.messageId,
        destinationIds: request.body.destinationIds,
        clientRequestId: request.body.clientRequestId
      }
    ));
  });

  app.put<{
    Params: MessageParams;
    Body: SetReactionBody;
  }>("/api/chats/:chatId/messages/:messageId/reaction", {
    config: { sensitiveBody: true },
    schema: {
      params: messageParamsSchema,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["clientRequestId", "reaction"],
        properties: {
          clientRequestId: clientRequestIdSchema,
          reaction: {
            anyOf: [
              {
                type: "string",
                enum: [
                  "like",
                  "heart",
                  "laugh",
                  "fire",
                  "cry",
                  "celebrate"
                ]
              },
              { type: "null" }
            ]
          }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply.send(await options.gateway.setReaction(
      principal.userLookup,
      {
        chatId: request.params.chatId,
        messageId: request.params.messageId,
        clientRequestId: request.body.clientRequestId,
        reaction: request.body.reaction
      }
    ));
  });

  app.post<{
    Params: AttachmentParams;
    Body: ChatActionBody;
  }>("/api/chats/:chatId/actions", {
    config: { sensitiveBody: true },
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["chatId"],
        properties: {
          chatId: { type: "string", minLength: 1, maxLength: 512 }
        }
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["clientRequestId", "action"],
        properties: {
          clientRequestId: clientRequestIdSchema,
          action: {
            type: "string",
            enum: [
              "pin",
              "unpin",
              "mark_unread",
              "mute",
              "unmute",
              "clear",
              "delete"
            ]
          },
          confirmedByUser: { type: "boolean" }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    const destructive = request.body.action === "clear"
      || request.body.action === "delete";
    if (destructive && request.body.confirmedByUser !== true) {
      await reply.code(400).send({
        code: "chat_action_confirmation_required"
      });
      return;
    }
    await reply.send(await options.gateway.chatAction(
      principal.userLookup,
      {
        chatId: request.params.chatId,
        clientRequestId: request.body.clientRequestId,
        action: request.body.action,
        ...(request.body.confirmedByUser === true
          ? { confirmedByUser: true }
          : {})
      }
    ));
  });

  app.get<{
    Params: AttachmentParams;
  }>("/api/chats/:chatId/stickers", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["chatId"],
        properties: {
          chatId: { type: "string", minLength: 1, maxLength: 512 }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeRead(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply
      .header("cache-control", "no-store")
      .send({
        stickers: await options.gateway.listStickers(
          principal.userLookup,
          request.params.chatId
        )
      });
  });

  app.post<{
    Params: StickerParams;
    Body: SendStickerBody;
  }>("/api/chats/:chatId/stickers/:stickerId", {
    config: { sensitiveBody: true },
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["chatId", "stickerId"],
        properties: {
          chatId: { type: "string", minLength: 1, maxLength: 512 },
          stickerId: { type: "string", minLength: 1, maxLength: 512 }
        }
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["clientRequestId"],
        properties: {
          clientRequestId: clientRequestIdSchema
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply.send(await options.gateway.sendSticker(
      principal.userLookup,
      {
        chatId: request.params.chatId,
        stickerId: request.params.stickerId,
        clientRequestId: request.body.clientRequestId
      }
    ));
  });

  done();
};

function safeAttachmentName(value: string): string {
  const safe = basename(value)
    .replaceAll("\0", "")
    .replace(/[^\p{L}\p{N}._() -]/gu, "_")
    .slice(0, 180)
    .trim();
  return safe.length > 0 ? safe : "attachment";
}

function authorizeMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  options: MessageRouteOptions
): SessionPrincipal | null {
  try {
    assertAllowedOrigin(request.headers.origin, options.allowedOrigins);
  } catch (error: unknown) {
    if (error instanceof OriginPolicyError) {
      void reply.code(403).send({ code: error.code });
      return null;
    }
    throw error;
  }
  const principal = options.resolvePrincipal(request);
  if (principal === null) {
    void reply.code(401).send({ code: "authentication_required" });
  }
  return principal;
}

function authorizeRead(
  request: FastifyRequest,
  reply: FastifyReply,
  options: MessageRouteOptions
): SessionPrincipal | null {
  const principal = options.resolvePrincipal(request);
  if (principal === null) {
    void reply.code(401).send({ code: "authentication_required" });
  }
  return principal;
}
import {
  mkdir,
  mkdtemp,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, join } from "node:path";
