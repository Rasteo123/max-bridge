import cookie from "@fastify/cookie";
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type { UserState } from "@maxbridge/core";

import {
  OriginPolicyError,
  assertAllowedOrigin
} from "./origin-policy.js";
import type {
  MemorySessionStore,
  SessionPrincipal
} from "./session-store.js";
import {
  TelegramInitDataError,
  validateTelegramInitData
} from "./telegram-init-data.js";

const SESSION_COOKIE = "__Host-maxbridge_session";
const SESSION_MAX_AGE_SECONDS = 600;

export type AuthUserGateway = {
  findPrincipal(telegramId: string): SessionPrincipal | null;
};

export type AuthRouteOptions = Readonly<{
  botToken: string;
  users: AuthUserGateway;
  sessions: MemorySessionStore;
  allowedOrigins: ReadonlySet<string>;
  nowSeconds?: () => number;
}>;

type TelegramAuthBody = {
  initData: string;
};

const approvedStates = new Set<UserState>([
  "approved_unbound",
  "authenticating",
  "active",
  "reauth_required"
]);

export const registerAuthRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  options
) => {
  await app.register(cookie);

  app.post<{ Body: TelegramAuthBody }>("/api/auth/telegram", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["initData"],
        properties: {
          initData: {
            type: "string",
            minLength: 1,
            maxLength: 8192
          }
        }
      }
    }
  }, async (request, reply) => {
    if (!checkOrigin(request, reply, options.allowedOrigins)) {
      return;
    }
    let telegramId: string;
    try {
      const validationOptions = options.nowSeconds === undefined
        ? {}
        : { nowSeconds: options.nowSeconds() };
      telegramId = validateTelegramInitData(
        request.body.initData,
        options.botToken,
        validationOptions
      ).telegramId;
    } catch (error: unknown) {
      if (error instanceof TelegramInitDataError) {
        await reply.code(401).send({ code: error.code });
        return;
      }
      throw error;
    }

    const principal = options.users.findPrincipal(telegramId);
    if (principal === null || principal.userState === "pending") {
      await reply.code(403).send({ code: "friend_approval_required" });
      return;
    }
    if (!approvedStates.has(principal.userState)) {
      await reply.code(403).send({ code: "access_disabled" });
      return;
    }

    const session = options.sessions.create(principal);
    reply.setCookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS
    });
    await reply.code(204).send();
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (!checkOrigin(request, reply, options.allowedOrigins)) {
      return;
    }
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined) {
      options.sessions.destroy(token);
    }
    reply.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/"
    });
    await reply.code(204).send();
  });

  app.get("/api/me", async (request, reply) => {
    const principal = resolvePrincipal(request, options.sessions);
    if (principal === null) {
      await reply.code(401).send({ code: "authentication_required" });
      return;
    }
    await reply.send({ state: principal.userState });
  });
};

function resolvePrincipal(
  request: FastifyRequest,
  sessions: MemorySessionStore
): SessionPrincipal | null {
  const token = request.cookies[SESSION_COOKIE];
  return token === undefined ? null : sessions.resolve(token);
}

function checkOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedOrigins: ReadonlySet<string>
): boolean {
  try {
    assertAllowedOrigin(request.headers.origin, allowedOrigins);
    return true;
  } catch (error: unknown) {
    if (error instanceof OriginPolicyError) {
      void reply.code(403).send({ code: error.code });
      return false;
    }
    throw error;
  }
}
