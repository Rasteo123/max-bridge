import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MaxLoginResult } from "@maxbridge/max-adapter";

import type { SessionPrincipal } from "../auth/session-store.js";
import {
  registerMaxLoginRoutes,
  type MaxLoginGateway
} from "./max-login.js";

const allowedOrigin = "https://max-users.online";
const principal: SessionPrincipal = {
  userLookup: "u_synthetic",
  userState: "approved_unbound"
};

let app: FastifyInstance;
let gateway: FakeMaxLoginGateway;
let authenticated = true;

beforeEach(async () => {
  gateway = new FakeMaxLoginGateway();
  authenticated = true;
  app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false
      }
    }
  });
  await app.register(registerMaxLoginRoutes, {
    gateway,
    allowedOrigins: new Set([allowedOrigin]),
    resolvePrincipal: () => authenticated ? principal : null,
    now: () => 1_000
  });
});

afterEach(async () => {
  await app.close();
});

describe("MAX login routes", () => {
  it("requires an authenticated approved Telegram session", async () => {
    authenticated = false;

    const response = await app.inject({
      method: "GET",
      url: "/api/max/login/status"
    });

    expect(response.statusCode).toBe(401);
  });

  it("passes phone bytes to the gateway and zeros them afterwards", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/max/login/phone",
      headers: { origin: allowedOrigin },
      payload: { phone: "+79990000000" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "code_required" });
    expect(gateway.observedPhone).toBeDefined();
    expect([...(gateway.observedPhone ?? [])].every(
      (value) => value === 0
    )).toBe(true);
  });

  it("rejects extra client identity fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/max/login/phone",
      headers: { origin: allowedOrigin },
      payload: {
        phone: "+79990000000",
        userId: "someone-else"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("streams QR bytes with no-store semantics", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/max/login/qr"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.rawPayload).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  it("locks login for 30 minutes after five failures", async () => {
    gateway.codeResult = { state: "invalid_code" };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await submitCode();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ state: "invalid_code" });
    }

    const blocked = await submitCode();

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ code: "login_temporarily_locked" });
    expect(blocked.headers["retry-after"]).toBe("1800");
    expect(gateway.codeCalls).toBe(5);
  });

  it("rejects a mutating request from another origin", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/max/logout",
      headers: { origin: "https://attacker.invalid" }
    });

    expect(response.statusCode).toBe(403);
    expect(gateway.logoutCalls).toBe(0);
  });
});

async function submitCode() {
  return app.inject({
    method: "POST",
    url: "/api/max/login/code",
    headers: { origin: allowedOrigin },
    payload: { code: "12345" }
  });
}

class FakeMaxLoginGateway implements MaxLoginGateway {
  observedPhone: Uint8Array | undefined;
  observedCode: Uint8Array | undefined;
  codeCalls = 0;
  logoutCalls = 0;
  codeResult: MaxLoginResult = { state: "authenticated" };

  submitPhone(
    _userLookup: string,
    phone: Uint8Array
  ): Promise<MaxLoginResult> {
    this.observedPhone = phone;
    return Promise.resolve({ state: "code_required" });
  }

  submitCode(
    _userLookup: string,
    code: Uint8Array
  ): Promise<MaxLoginResult> {
    this.observedCode = code;
    this.codeCalls += 1;
    return Promise.resolve(this.codeResult);
  }

  getQrPng(): Promise<Buffer> {
    return Promise.resolve(Buffer.from([137, 80, 78, 71]));
  }

  status(): Promise<MaxLoginResult> {
    return Promise.resolve({ state: "method_required" });
  }

  logout(): Promise<void> {
    this.logoutCalls += 1;
    return Promise.resolve();
  }
}
