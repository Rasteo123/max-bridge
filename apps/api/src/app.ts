import { resolve } from "node:path";

import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, {
  type FastifyRequest
} from "fastify";

import {
  registerAuthRoutes,
  resolveSessionPrincipal,
  type AuthUserGateway
} from "./auth/auth-routes.js";
import type {
  MemorySessionStore,
  SessionPrincipal
} from "./auth/session-store.js";
import {
  registerPublicErrors
} from "./plugins/errors.js";
import { secureLoggerOptions } from "./plugins/logging.js";
import { registerSecurity } from "./plugins/security.js";
import {
  registerChatRoutes,
  type ChatGateway
} from "./routes/chats.js";
import { registerHealthRoutes } from "./routes/health.js";
import {
  registerMaxLoginRoutes,
  type MaxLoginGateway
} from "./routes/max-login.js";
import {
  registerMediaRoutes,
  type MediaGateway
} from "./routes/media.js";
import {
  registerMessageRoutes,
  type MessageGateway
} from "./routes/messages.js";
import {
  registerWebSocketRoute,
  type LiveGateway
} from "./routes/websocket.js";

export const DEFAULT_API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 3_100;
export const DEFAULT_BODY_LIMIT = 1_048_576;

export type AppServices = Readonly<{
  sessions: MemorySessionStore;
  auth: Readonly<{
    botToken: string;
    users: AuthUserGateway;
  }>;
  chats: ChatGateway;
  maxLogin: MaxLoginGateway;
  messages: MessageGateway;
  live: LiveGateway;
  media?: MediaGateway;
  ready: () => boolean;
}>;

export type BuildAppOptions = Readonly<{
  services: AppServices;
  allowedOrigins: ReadonlySet<string>;
  allowedHosts: ReadonlySet<string>;
  logger?: boolean;
  webRoot?: string;
}>;

export async function buildApp(
  options: BuildAppOptions
) {
  const configuredLogger = options.logger === true
    ? secureLoggerOptions()
    : false;
  const app = Fastify({
    logger: configuredLogger ?? false,
    bodyLimit: DEFAULT_BODY_LIMIT,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false
      }
    }
  });

  await app.register(cookie);
  await app.register(websocket, {
    options: {
      maxPayload: 8_192
    }
  });
  await app.register(registerSecurity, {
    allowedHosts: options.allowedHosts,
    allowedOrigins: options.allowedOrigins
  });
  await app.register(registerPublicErrors);

  const resolvePrincipal = (
    request: FastifyRequest
  ): SessionPrincipal | null =>
    resolveSessionPrincipal(request, options.services.sessions);

  await app.register(registerAuthRoutes, {
    botToken: options.services.auth.botToken,
    users: options.services.auth.users,
    sessions: options.services.sessions,
    allowedOrigins: options.allowedOrigins
  });
  await app.register(registerMaxLoginRoutes, {
    gateway: options.services.maxLogin,
    allowedOrigins: options.allowedOrigins,
    resolvePrincipal
  });
  await app.register(registerChatRoutes, {
    gateway: options.services.chats,
    resolvePrincipal
  });
  await app.register(registerMessageRoutes, {
    gateway: options.services.messages,
    allowedOrigins: options.allowedOrigins,
    resolvePrincipal
  });
  await app.register(registerWebSocketRoute, {
    gateway: options.services.live,
    allowedOrigins: options.allowedOrigins,
    resolvePrincipal
  });
  if (options.services.media !== undefined) {
    await app.register(registerMediaRoutes, {
      gateway: options.services.media,
      resolvePrincipal
    });
  }
  await app.register(registerHealthRoutes, {
    ready: options.services.ready
  });

  if (options.webRoot !== undefined) {
    await app.register(staticFiles, {
      root: resolve(options.webRoot),
      prefix: "/",
      decorateReply: false,
      cacheControl: false
    });
  }

  return app;
}
