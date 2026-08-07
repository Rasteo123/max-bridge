import type {
  ChatSummary,
  Message
} from "@maxbridge/core";
import type {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type { SessionPrincipal } from "../auth/session-store.js";

export interface ChatGateway {
  list(userLookup: string): Promise<readonly ChatSummary[]>;
  search(
    userLookup: string,
    query: string
  ): Promise<readonly ChatSummary[]>;
  history(
    userLookup: string,
    chatId: string,
    cursor?: string
  ): Promise<readonly Message[] | null>;
}

export type ChatRouteOptions = Readonly<{
  gateway: ChatGateway;
  resolvePrincipal: (
    request: FastifyRequest
  ) => SessionPrincipal | null;
}>;

type SearchQuery = { q: string };
type HistoryParams = { id: string };
type HistoryQuery = { cursor?: string };

export const registerChatRoutes: FastifyPluginCallback<
  ChatRouteOptions
> = (app, options, done) => {
  app.get("/api/chats", async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply
      .header("cache-control", "no-store")
      .send({ chats: await options.gateway.list(principal.userLookup) });
  });

  app.get<{ Querystring: SearchQuery }>("/api/chats/search", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["q"],
        properties: {
          q: { type: "string", minLength: 1, maxLength: 128 }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply
      .header("cache-control", "no-store")
      .send({
        chats: await options.gateway.search(
          principal.userLookup,
          request.query.q
        )
      });
  });

  app.get<{
    Params: HistoryParams;
    Querystring: HistoryQuery;
  }>("/api/chats/:id/messages", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 512 }
        }
      },
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          cursor: { type: "string", minLength: 1, maxLength: 512 }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    const messages = await options.gateway.history(
      principal.userLookup,
      request.params.id,
      request.query.cursor
    );
    if (messages === null) {
      await reply.code(404).send({ code: "chat_not_found" });
      return;
    }
    await reply
      .header("cache-control", "no-store")
      .send({ messages });
  });
  done();
};

function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  options: ChatRouteOptions
): SessionPrincipal | null {
  const principal = options.resolvePrincipal(request);
  if (principal === null) {
    void reply.code(401).send({ code: "authentication_required" });
  }
  return principal;
}
