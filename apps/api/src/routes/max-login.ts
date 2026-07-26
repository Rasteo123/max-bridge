import type {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest
} from "fastify";

import { zeroBuffer } from "@maxbridge/core";
import type { MaxLoginResult } from "@maxbridge/max-adapter";

import {
  OriginPolicyError,
  assertAllowedOrigin
} from "../auth/origin-policy.js";
import type { SessionPrincipal } from "../auth/session-store.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";

export type CaptchaPointerInput = Readonly<{
  phase: "down" | "move" | "up";
  x: number;
  y: number;
}>;

export interface MaxLoginGateway {
  submitPhone(
    userLookup: string,
    phone: Uint8Array
  ): Promise<MaxLoginResult>;
  submitCode(
    userLookup: string,
    code: Uint8Array
  ): Promise<MaxLoginResult>;
  getQrPng(userLookup: string): Promise<Buffer>;
  getCaptchaPng(userLookup: string): Promise<Buffer>;
  sendCaptchaPointer(
    userLookup: string,
    input: CaptchaPointerInput
  ): Promise<MaxLoginResult>;
  status(userLookup: string): Promise<MaxLoginResult>;
  logout(userLookup: string): Promise<void>;
}

export type MaxLoginRouteOptions = Readonly<{
  gateway: MaxLoginGateway;
  allowedOrigins: ReadonlySet<string>;
  resolvePrincipal: (
    request: FastifyRequest
  ) => SessionPrincipal | null;
  now?: () => number;
}>;

type PhoneBody = { phone: string };
type CodeBody = { code: string };
type CaptchaPointerBody = {
  phase: "down" | "move" | "up";
  x: number;
  y: number;
};

export const registerMaxLoginRoutes: FastifyPluginCallback<
  MaxLoginRouteOptions
> = (app, options, done) => {
  const limiter = new LoginRateLimiter(
    options.now === undefined ? {} : { now: options.now },
  );
  const now = options.now ?? Date.now;
  const captchaFrames = new SlidingWindowLimiter(now, 30, 10_000);
  const captchaGestures = new SlidingWindowLimiter(now, 400, 10_000);

  app.post<{ Body: PhoneBody }>("/api/max/login/phone", {
    config: { sensitiveBody: true },
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["phone"],
        properties: {
          phone: {
            type: "string",
            pattern: "^\\+[1-9]\\d{7,14}$"
          }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null || rejectLocked(principal, reply, limiter)) {
      return;
    }
    const phone = new TextEncoder().encode(request.body.phone);
    try {
      const result = await options.gateway.submitPhone(
        principal.userLookup,
        phone
      );
      await sendLoginResult(reply, principal.userLookup, result, limiter);
    } finally {
      zeroBuffer(phone);
    }
  });

  app.post<{ Body: CodeBody }>("/api/max/login/code", {
    config: { sensitiveBody: true },
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["code"],
        properties: {
          code: {
            type: "string",
            pattern: "^\\d{4,8}$"
          }
        }
      }
    }
  }, async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null || rejectLocked(principal, reply, limiter)) {
      return;
    }
    const code = new TextEncoder().encode(request.body.code);
    try {
      const result = await options.gateway.submitCode(
        principal.userLookup,
        code
      );
      await sendLoginResult(reply, principal.userLookup, result, limiter);
    } finally {
      zeroBuffer(code);
    }
  });

  app.get("/api/max/login/qr", async (request, reply) => {
    const principal = authorizeRead(request, reply, options);
    if (principal === null || rejectLocked(principal, reply, limiter)) {
      return;
    }
    const image = await options.gateway.getQrPng(principal.userLookup);
    await reply
      .header("cache-control", "no-store")
      .type("image/png")
      .send(image);
  });

  app.get("/api/max/login/captcha", async (request, reply) => {
    const principal = authorizeRead(request, reply, options);
    if (
      principal === null
      || rejectLocked(principal, reply, limiter)
      || rejectCaptchaTraffic(
        principal.userLookup,
        reply,
        captchaFrames
      )
    ) {
      return;
    }
    const image = await options.gateway.getCaptchaPng(principal.userLookup);
    await reply
      .header("cache-control", "no-store")
      .type("image/png")
      .send(image);
  });

  app.post<{ Body: CaptchaPointerBody }>(
    "/api/max/login/captcha/pointer",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["phase", "x", "y"],
          properties: {
            phase: {
              type: "string",
              enum: ["down", "move", "up"]
            },
            x: {
              type: "number",
              minimum: 0,
              maximum: 1
            },
            y: {
              type: "number",
              minimum: 0,
              maximum: 1
            }
          }
        }
      }
    },
    async (request, reply) => {
      const principal = authorizeMutation(request, reply, options);
      if (
        principal === null
        || rejectLocked(principal, reply, limiter)
        || rejectCaptchaTraffic(
          principal.userLookup,
          reply,
          captchaGestures
        )
      ) {
        return;
      }
      await reply.send(await options.gateway.sendCaptchaPointer(
        principal.userLookup,
        request.body
      ));
    }
  );

  app.get("/api/max/login/status", async (request, reply) => {
    const principal = authorizeRead(request, reply, options);
    if (principal === null) {
      return;
    }
    await reply.send(
      await options.gateway.status(principal.userLookup)
    );
  });

  app.post("/api/max/logout", async (request, reply) => {
    const principal = authorizeMutation(request, reply, options);
    if (principal === null) {
      return;
    }
    await options.gateway.logout(principal.userLookup);
    limiter.reset(principal.userLookup);
    await reply.code(204).send();
  });

  done();
};

function authorizeMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  options: MaxLoginRouteOptions
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
  return authorizeRead(request, reply, options);
}

function authorizeRead(
  request: FastifyRequest,
  reply: FastifyReply,
  options: MaxLoginRouteOptions
): SessionPrincipal | null {
  const principal = options.resolvePrincipal(request);
  if (principal === null) {
    void reply.code(401).send({ code: "authentication_required" });
  }
  return principal;
}

function rejectLocked(
  principal: SessionPrincipal,
  reply: FastifyReply,
  limiter: LoginRateLimiter
): boolean {
  const retryAfterSeconds = limiter.retryAfterSeconds(principal.userLookup);
  if (retryAfterSeconds === 0) {
    return false;
  }
  void reply
    .header("retry-after", retryAfterSeconds)
    .code(429)
    .send({ code: "login_temporarily_locked" });
  return true;
}

async function sendLoginResult(
  reply: FastifyReply,
  userLookup: string,
  result: MaxLoginResult,
  limiter: LoginRateLimiter
): Promise<void> {
  if (result.state === "invalid_code" || result.state === "failed") {
    limiter.recordFailure(userLookup);
    await reply.send(result);
    return;
  }
  if (result.state === "authenticated") {
    limiter.reset(userLookup);
  }
  await reply.send(result);
}

class SlidingWindowLimiter {
  private readonly windows = new Map<
    string,
    { startedAt: number; count: number }
  >();

  constructor(
    private readonly now: () => number,
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  retryAfterSeconds(key: string): number {
    const current = this.now();
    const window = this.windows.get(key);
    if (
      window === undefined
      || current - window.startedAt >= this.windowMs
    ) {
      this.windows.set(key, { startedAt: current, count: 1 });
      return 0;
    }
    if (window.count >= this.limit) {
      return Math.max(
        1,
        Math.ceil(
          (window.startedAt + this.windowMs - current) / 1_000
        )
      );
    }
    window.count += 1;
    return 0;
  }
}

function rejectCaptchaTraffic(
  userLookup: string,
  reply: FastifyReply,
  limiter: SlidingWindowLimiter
): boolean {
  const retryAfterSeconds = limiter.retryAfterSeconds(userLookup);
  if (retryAfterSeconds === 0) {
    return false;
  }
  void reply
    .header("retry-after", retryAfterSeconds)
    .code(429)
    .send({ code: "captcha_temporarily_limited" });
  return true;
}
