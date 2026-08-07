import type {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type { SessionPrincipal } from "../auth/session-store.js";
import type { NotificationPreferences } from "../db/users-repository.js";

export interface NotificationPreferencesGateway {
  load(userLookup: string): Promise<NotificationPreferences>;
  save(
    userLookup: string,
    preferences: NotificationPreferences
  ): Promise<void>;
}

export type NotificationRouteOptions = Readonly<{
  gateway: NotificationPreferencesGateway;
  resolvePrincipal: (
    request: FastifyRequest
  ) => SessionPrincipal | null;
}>;

/** MAX itself stops at 250 muted chats, and so does the stored list. */
const MAX_MUTED_CHATS = 250;

export const registerNotificationRoutes: FastifyPluginCallback<
  NotificationRouteOptions
> = (app, options, done) => {
  app.get("/api/notifications", async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply
      .header("cache-control", "no-store")
      .send(await options.gateway.load(principal.userLookup));
  });

  app.put<{ Body: { enabled: boolean } }>("/api/notifications", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["enabled"],
        properties: { enabled: { type: "boolean" } }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    const current = await options.gateway.load(principal.userLookup);
    const next = { ...current, enabled: request.body.enabled };
    await options.gateway.save(principal.userLookup, next);
    await reply.header("cache-control", "no-store").send(next);
  });

  app.put<{
    Params: { id: string };
    Body: { muted: boolean };
  }>("/api/notifications/chats/:id", {
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
        required: ["muted"],
        properties: { muted: { type: "boolean" } }
      }
    }
  }, async (request, reply) => {
    const principal = authorize(request, reply, options);
    if (principal === null) {
      return;
    }
    const current = await options.gateway.load(principal.userLookup);
    const muted = new Set(current.mutedChatIds);
    if (request.body.muted) {
      muted.add(request.params.id);
    } else {
      muted.delete(request.params.id);
    }
    if (muted.size > MAX_MUTED_CHATS) {
      await reply.code(409).send({ code: "too_many_muted_chats" });
      return;
    }
    const next = { ...current, mutedChatIds: [...muted] };
    await options.gateway.save(principal.userLookup, next);
    await reply.header("cache-control", "no-store").send(next);
  });

  done();
};

function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  options: NotificationRouteOptions
): SessionPrincipal | null {
  const principal = options.resolvePrincipal(request);
  if (principal === null) {
    void reply.code(401).send({ code: "authentication_required" });
  }
  return principal;
}
