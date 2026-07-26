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

const commonTextProperties = {
  kind: { type: "string", const: "text" },
  chatId: { type: "string", minLength: 1, maxLength: 512 },
  clientRequestId: { type: "string", minLength: 1, maxLength: 128 },
  text: { type: "string", minLength: 1, maxLength: 65_536 }
} as const;

export const registerMessageRoutes: FastifyPluginCallback<
  MessageRouteOptions
> = (app, options, done) => {
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

  done();
};

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
