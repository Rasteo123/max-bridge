import type {
  AccountSettings,
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
  comments(
    userLookup: string,
    chatId: string,
    postId: string
  ): Promise<readonly Message[] | null>;
  describeContact(
    userLookup: string,
    contactId: string
  ): Promise<ChatSummary | null>;
  joinChat(
    userLookup: string,
    link: string
  ): Promise<ChatSummary | null>;
  leaveChat(userLookup: string, chatId: string): Promise<boolean>;
  settings(userLookup: string): Promise<AccountSettings>;
  resolveChat(
    userLookup: string,
    chatId: string
  ): Promise<ChatSummary | null>;
  markRead(
    userLookup: string,
    chatId: string,
    messageId: string
  ): Promise<boolean>;
}

export type ChatRouteOptions = Readonly<{
  gateway: ChatGateway;
  resolvePrincipal: (
    request: FastifyRequest
  ) => SessionPrincipal | null;
}>;

type SearchQuery = { q: string };
type CommentParams = { id: string; messageId: string };
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
  app.post<{
    Params: { id: string };
    Body: { messageId: string };
  }>("/api/chats/:id/read", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 512 }
        }
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["messageId"],
        properties: {
          messageId: { type: "string", minLength: 1, maxLength: 512 }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    const read = await options.gateway.markRead(
      principal.userLookup,
      request.params.id,
      request.body.messageId
    );
    await reply
      .header("cache-control", "no-store")
      .send({ read });
  });

  app.get<{ Params: { id: string } }>("/api/chats/:id/info", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 512 }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    const chat = await options.gateway.resolveChat(
      principal.userLookup,
      request.params.id
    );
    if (chat === null) {
      await reply.code(404).send({ code: "chat_not_found" });
      return;
    }
    await reply.header("cache-control", "no-store").send({ chat });
  });

  app.get<{ Params: CommentParams }>(
    "/api/chats/:id/messages/:messageId/comments",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id", "messageId"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 512 },
            messageId: { type: "string", minLength: 1, maxLength: 512 }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authorize(request, reply, options);
      if (principal === null) {
        return;
      }
      const messages = await options.gateway.comments(
        principal.userLookup,
        request.params.id,
        request.params.messageId
      );
      if (messages === null) {
        await reply.code(404).send({ code: "chat_not_found" });
        return;
      }
      await reply
        .header("cache-control", "no-store")
        .send({ messages });
    }
  );
  app.post<{ Body: { link: string } }>("/api/chats/subscribe", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["link"],
        properties: {
          link: {
            type: "string",
            minLength: 16,
            maxLength: 256,
            pattern: "^https://max\\.ru/[\\w.~-]{1,128}$"
          }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    const chat = await options.gateway.joinChat(
      principal.userLookup,
      request.body.link
    );
    if (chat === null) {
      await reply.code(404).send({ code: "chat_not_found" });
      return;
    }
    await reply.header("cache-control", "no-store").send({ chat });
  });

  app.post<{ Params: { id: string } }>("/api/chats/:id/unsubscribe", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 512 }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    const left = await options.gateway.leaveChat(
      principal.userLookup,
      request.params.id
    );
    if (!left) {
      await reply.code(404).send({ code: "chat_not_found" });
      return;
    }
    await reply.header("cache-control", "no-store").send({ unsubscribed: true });
  });

  app.get("/api/settings", async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply
      .header("cache-control", "no-store")
      .send({ settings: await options.gateway.settings(principal.userLookup) });
  });

  app.get<{ Params: { id: string } }>("/api/contacts/:id", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64 }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    const contact = await options.gateway.describeContact(
      principal.userLookup,
      request.params.id
    );
    if (contact === null) {
      await reply.code(404).send({ code: "contact_not_found" });
      return;
    }
    await reply
      .header("cache-control", "no-store")
      .send({ contact });
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
