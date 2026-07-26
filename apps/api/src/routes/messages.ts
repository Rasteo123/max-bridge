import type {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest
} from "fastify";

import { zeroBuffer } from "@maxbridge/core";

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
    }>
  ): Promise<MessageRouteResult>;
  retryText(
    userLookup: string,
    input: Readonly<{
      retryOf: string;
      chatId: string;
      clientRequestId: string;
      text: Uint8Array;
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
}

export type MessageRouteOptions = Readonly<{
  gateway: MessageGateway;
  allowedOrigins: ReadonlySet<string>;
  resolvePrincipal: (
    request: FastifyRequest
  ) => SessionPrincipal | null;
}>;

type TextBody = {
  kind: "text";
  chatId: string;
  clientRequestId: string;
  text: string;
};

type RetryBody = TextBody & {
  retryOf: string;
  confirmedByUser: boolean;
};

type AttachmentParams = { chatId: string };
type AttachmentQuery = {
  kind: "media" | "file";
  name: string;
  clientRequestId: string;
};

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MEDIA_ROOT = "/run/maxbridge/media";

const commonTextProperties = {
  kind: { type: "string", const: "text" },
  chatId: { type: "string", minLength: 1, maxLength: 512 },
  clientRequestId: { type: "string", minLength: 1, maxLength: 128 },
  text: { type: "string", minLength: 1, maxLength: 65_536 }
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
          text
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
    await mkdir(MEDIA_ROOT, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(MEDIA_ROOT, "upload-"));
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
import {
  mkdir,
  mkdtemp,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, join } from "node:path";
