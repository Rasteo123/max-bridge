import { createHmac } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MemorySessionStore,
  type SessionPrincipal
} from "./session-store.js";
import {
  registerAuthRoutes,
  type AuthUserGateway
} from "./auth-routes.js";

const botToken = "123456:synthetic_bot_token";
const allowedOrigin = "https://max-users.online";
const nowSeconds = 1_774_700_000;
const activePrincipal: SessionPrincipal = {
  userLookup: "u_synthetic_active",
  userState: "active"
};

let app: FastifyInstance;
let userGateway: FakeUserGateway;

beforeEach(async () => {
  app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false
      }
    }
  });
  userGateway = new FakeUserGateway();
  await app.register(registerAuthRoutes, {
    botToken,
    users: userGateway,
    sessions: new MemorySessionStore({
      now: () => nowSeconds * 1000,
      idleTtlMs: 600_000
    }),
    allowedOrigins: new Set([allowedOrigin]),
    nowSeconds: () => nowSeconds
  });
});

afterEach(async () => {
  await app.close();
});

describe("auth routes", () => {
  it("issues a hardened session cookie to an approved user", async () => {
    userGateway.principal = activePrincipal;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      headers: { origin: allowedOrigin },
      payload: { initData: signedInitData("123456789") }
    });

    expect(response.statusCode).toBe(204);
    const cookie = response.headers["set-cookie"];
    expect(cookie).toContain("__Host-maxbridge_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=86400");
  });

  it("rejects a pending user", async () => {
    userGateway.principal = {
      userLookup: "u_synthetic_pending",
      userState: "pending"
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      headers: { origin: allowedOrigin },
      payload: { initData: signedInitData("123456789") }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "friend_approval_required" });
  });

  it("rejects a client-supplied userId field", async () => {
    userGateway.principal = activePrincipal;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      headers: { origin: allowedOrigin },
      payload: {
        initData: signedInitData("123456789"),
        userId: "someone-else"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a wrong origin", async () => {
    userGateway.principal = activePrincipal;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      headers: { origin: "https://attacker.invalid" },
      payload: { initData: signedInitData("123456789") }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "origin_not_allowed" });
  });

  it("resolves /api/me only from the session cookie", async () => {
    userGateway.principal = activePrincipal;
    const auth = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      headers: { origin: allowedOrigin },
      payload: { initData: signedInitData("123456789") }
    });
    const cookie = auth.cookies[0];

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        origin: allowedOrigin,
        cookie: `${cookie?.name ?? ""}=${cookie?.value ?? ""}`
      }
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      state: "active"
    });
  });

  it("destroys the cookie on logout", async () => {
    userGateway.principal = activePrincipal;
    const auth = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      headers: { origin: allowedOrigin },
      payload: { initData: signedInitData("123456789") }
    });
    const cookie = auth.cookies[0];
    const serializedCookie = `${cookie?.name ?? ""}=${cookie?.value ?? ""}`;

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        origin: allowedOrigin,
        cookie: serializedCookie
      }
    });
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        origin: allowedOrigin,
        cookie: serializedCookie
      }
    });

    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect(me.statusCode).toBe(401);
  });
});

class FakeUserGateway implements AuthUserGateway {
  principal: SessionPrincipal | null = null;

  findPrincipal(telegramId: string): SessionPrincipal | null {
    return telegramId === "123456789" ? this.principal : null;
  }
}

function signedInitData(telegramId: string): string {
  const fields = {
    auth_date: String(nowSeconds),
    user: JSON.stringify({
      id: Number(telegramId),
      first_name: "Synthetic"
    })
  };
  const check = Object.entries(fields)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
