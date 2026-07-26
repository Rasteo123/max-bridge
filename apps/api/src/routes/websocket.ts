import type { BridgeEvent } from "@maxbridge/core";
import type {
  FastifyPluginCallback,
  FastifyRequest
} from "fastify";
import type WebSocket from "ws";

import {
  OriginPolicyError,
  assertAllowedOrigin
} from "../auth/origin-policy.js";
import type { SessionPrincipal } from "../auth/session-store.js";

export interface LiveGateway {
  canAccessChat(
    userLookup: string,
    chatId: string
  ): Promise<boolean>;
  subscribe(
    userLookup: string,
    listener: (event: BridgeEvent) => void
  ): () => void;
}

export type WebSocketRouteOptions = Readonly<{
  gateway: LiveGateway;
  allowedOrigins: ReadonlySet<string>;
  resolvePrincipal: (
    request: FastifyRequest
  ) => SessionPrincipal | null;
}>;

export const registerWebSocketRoute: FastifyPluginCallback<
  WebSocketRouteOptions
> = (app, options, done) => {
  app.get("/api/ws", {
    websocket: true,
    preValidation: async (request, reply) => {
      try {
        assertAllowedOrigin(
          request.headers.origin,
          options.allowedOrigins
        );
      } catch (error: unknown) {
        if (error instanceof OriginPolicyError) {
          await reply.code(403).send({ code: error.code });
          return;
        }
        throw error;
      }
      if (options.resolvePrincipal(request) === null) {
        await reply.code(401).send({
          code: "authentication_required"
        });
      }
    }
  }, (socket, request) => {
    const principal = options.resolvePrincipal(request);
    if (principal === null) {
      socket.close(1008, "authentication_required");
      return;
    }
    const unsubscribe = options.gateway.subscribe(
      principal.userLookup,
      (event) => {
        sendJson(socket, { type: "event", event });
      }
    );
    socket.once("close", unsubscribe);
    socket.on("message", (data) => {
      void handleClientMessage(
        socket,
        data,
        principal,
        options.gateway
      );
    });
    sendJson(socket, { type: "ready" });
  });
  done();
};

async function handleClientMessage(
  socket: WebSocket,
  data: WebSocket.RawData,
  principal: SessionPrincipal,
  gateway: LiveGateway
): Promise<void> {
  const bytes = rawDataLength(data);
  if (bytes > 8_192) {
    sendJson(socket, { type: "error", code: "invalid_request" });
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(rawDataText(data)) as unknown;
  } catch {
    sendJson(socket, { type: "error", code: "invalid_request" });
    return;
  }
  if (
    message === null
    || typeof message !== "object"
    || Array.isArray(message)
  ) {
    sendJson(socket, { type: "error", code: "invalid_request" });
    return;
  }
  const record = message as Record<string, unknown>;
  if (
    record["type"] !== "open_chat"
    || typeof record["chatId"] !== "string"
    || record["chatId"].length < 1
    || record["chatId"].length > 512
    || Object.keys(record).some((key) =>
      key !== "type" && key !== "chatId"
    )
  ) {
    sendJson(socket, { type: "error", code: "invalid_request" });
    return;
  }
  if (!await gateway.canAccessChat(
    principal.userLookup,
    record["chatId"]
  )) {
    sendJson(socket, { type: "error", code: "chat_not_found" });
    return;
  }
  sendJson(socket, { type: "chat_opened", chatId: record["chatId"] });
}

function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}

function rawDataLength(data: WebSocket.RawData): number {
  if (Array.isArray(data)) {
    return data.reduce((total, part) => total + part.byteLength, 0);
  }
  return data.byteLength;
}

function rawDataText(data: WebSocket.RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}
