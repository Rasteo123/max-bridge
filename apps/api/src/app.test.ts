import type { IncomingMessage } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { MemorySessionStore } from "./auth/session-store.js";
import {
  DEFAULT_API_HOST,
  buildApp,
  type AppServices
} from "./app.js";

let sessions: MemorySessionStore;
let services: AppServices;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  sessions = new MemorySessionStore();
  services = createServices(sessions);
  app = await buildApp({
    services,
    allowedOrigins: new Set(["https://max-users.online"]),
    allowedHosts: new Set([
      "max-users.online",
      "127.0.0.1",
      "localhost"
    ]),
    logger: false
  });
});

afterEach(async () => {
  await app.close();
});

describe("hardened Fastify app", () => {
  it("defaults to loopback and exposes secret-free health", async () => {
    expect(DEFAULT_API_HOST).toBe("127.0.0.1");

    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { host: "max-users.online" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.body).not.toContain("token");
    expect(response.body).not.toContain("91.107.201.91");
  });

  it("rejects unknown hosts and sends strict browser security headers", async () => {
    const rejected = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { host: "attacker.invalid" }
    });
    expect(rejected.statusCode).toBe(421);

    const accepted = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { host: "max-users.online" }
    });
    expect(accepted.headers["content-security-policy"]).toContain(
      "default-src 'self'"
    );
    expect(accepted.headers["x-content-type-options"]).toBe("nosniff");
    expect(accepted.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("accepts only a MAX channel address when joining", async () => {
    const foreign = await app.inject({
      method: "POST",
      url: "/api/chats/subscribe",
      headers: {
        host: "max-users.online",
        origin: "https://max-users.online",
        cookie: sessionCookie("user-a")
      },
      payload: { link: "https://evil.test/channel" }
    });
    expect(foreign.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/chats/subscribe",
      headers: {
        host: "max-users.online",
        origin: "https://max-users.online",
        cookie: sessionCookie("user-a")
      },
      payload: { link: "https://max.ru/sumrak6969" }
    });
    expect(accepted.statusCode).toBe(404);

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/chats/chat-a/unsubscribe",
      headers: {
        host: "max-users.online",
        origin: "https://max-users.online"
      }
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it("answers a contact profile only for a signed-in viewer", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/contacts/37921833",
      headers: { host: "max-users.online" }
    });
    expect(unauthenticated.statusCode).toBe(401);

    const unknown = await app.inject({
      method: "GET",
      url: "/api/contacts/37921833",
      headers: {
        host: "max-users.online",
        cookie: sessionCookie("user-a")
      }
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ code: "contact_not_found" });
  });

  it("guards global search behind a session and a bounded query", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/chats/search?q=%D0%BD%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8",
      headers: { host: "max-users.online" }
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missingQuery = await app.inject({
      method: "GET",
      url: "/api/chats/search",
      headers: {
        host: "max-users.online",
        cookie: sessionCookie("user-a")
      }
    });
    expect(missingQuery.statusCode).toBe(400);

    const oversizedQuery = await app.inject({
      method: "GET",
      url: `/api/chats/search?q=${"x".repeat(200)}`,
      headers: {
        host: "max-users.online",
        cookie: sessionCookie("user-a")
      }
    });
    expect(oversizedQuery.statusCode).toBe(400);

    const found = await app.inject({
      method: "GET",
      url: "/api/chats/search?q=news",
      headers: {
        host: "max-users.online",
        cookie: sessionCookie("user-a")
      }
    });
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toBe("no-store");
    expect(found.json()).toEqual({ chats: [] });
  });

  it("requires a valid short session for chats and bounds request bodies", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/chats",
      headers: { host: "max-users.online" }
    });
    expect(unauthenticated.statusCode).toBe(401);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: {
        host: "max-users.online",
        origin: "https://max-users.online",
        cookie: sessionCookie("user-a")
      },
      payload: {
        kind: "text",
        chatId: "chat-a",
        clientRequestId: "request-a",
        text: "x".repeat(1_100_000)
      }
    });
    expect(oversized.statusCode).toBe(413);
  });

  it("rejects forged session handles and returns bounded public errors", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: {
        host: "max-users.online",
        origin: "https://max-users.online",
        cookie: sessionCookie("user-a")
      },
      payload: {
        kind: "text",
        chatId: "chat-a",
        clientRequestId: "request-a",
        text: "hello",
        sessionHandle: "forged"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "invalid_request"
    });
    expect(response.body).not.toContain("sessionHandle");
  });

  it("authenticates a real loopback WebSocket upgrade by cookie and origin", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const url = address.replace(/^http/u, "ws") + "/api/ws";
    const rejected = new WebSocket(url, {
      headers: {
        host: "localhost",
        origin: "https://max-users.online"
      }
    });
    rejected.on("error", () => undefined);
    const errorResponse = await waitForUnexpectedResponse(rejected);
    expect(errorResponse).toBeDefined();
    errorResponse.destroy();

    const accepted = new WebSocket(url, {
      headers: {
        host: "localhost",
        origin: "https://max-users.online",
        cookie: sessionCookie("user-a")
      }
    });
    const ready = waitForMessage(accepted);
    await waitForOpen(accepted);
    const message = await ready;
    expect(JSON.parse(rawDataText(message))).toEqual({ type: "ready" });
    accepted.close();
  });
});

function waitForUnexpectedResponse(
  socket: WebSocket
): Promise<IncomingMessage> {
  return new Promise((resolve) => {
    socket.once("unexpected-response", (_request, response) => {
      resolve(response);
    });
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<WebSocket.RawData> {
  return new Promise((resolve, reject) => {
    socket.once("message", resolve);
    socket.once("error", reject);
  });
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

function sessionCookie(userLookup: string): string {
  const session = sessions.create({
    userLookup,
    userState: "active"
  });
  return `__Host-maxbridge_session=${session.token}`;
}

function createServices(store: MemorySessionStore): AppServices {
  return {
    sessions: store,
    auth: {
      botToken: "123456:synthetic-bot-token",
      users: {
        findPrincipal: () => null
      }
    },
    chats: {
      list: (userLookup) => Promise.resolve([{
        id: `chat-${userLookup}`,
        kind: "direct",
        title: "Synthetic",
        preview: "",
        timestamp: "2026-01-01T00:00:00.000Z",
        unreadCount: 0,
        muted: false
      }]),
      search: () => Promise.resolve([]),
      comments: () => Promise.resolve([]),
      describeContact: () => Promise.resolve(null),
      joinChat: () => Promise.resolve(null),
      leaveChat: () => Promise.resolve(false),
      settings: () => Promise.resolve({
      profile: { title: "Профиль" },
      sessions: [],
      blocked: []
    }),
      history: () => Promise.resolve([])
    },
    maxLogin: {
      submitPhone: () => Promise.resolve({ state: "code_required" }),
      submitCode: () => Promise.resolve({ state: "authenticated" }),
      getQrPng: () => Promise.resolve(Buffer.from([137, 80, 78, 71])),
      getCaptchaPng: () => Promise.resolve(Buffer.from([137, 80, 78, 71])),
      sendCaptchaPointer: () => Promise.resolve({
        state: "captcha_required"
      }),
      status: () => Promise.resolve({ state: "authenticated" }),
      logout: () => Promise.resolve()
    },
    messages: {
      sendText: () => Promise.resolve({
        state: "confirmed",
        operationId: "op"
      }),
      retryText: () => Promise.resolve({
        state: "confirmed",
        operationId: "op-retry"
      }),
      editMessage: () => Promise.resolve({
        state: "confirmed",
        operationId: "op-edit"
      }),
      deleteMessage: () => Promise.resolve({
        state: "confirmed",
        operationId: "op-delete"
      }),
      forwardMessage: () => Promise.resolve({
        state: "confirmed",
        operationId: "op-forward"
      }),
      setReaction: () => Promise.resolve({
        state: "confirmed",
        operationId: "op-reaction"
      }),
      chatAction: () => Promise.resolve({
        state: "confirmed",
        operationId: "op-chat-action"
      }),
      listStickers: () => Promise.resolve([]),
      sendSticker: () => Promise.resolve({
        state: "confirmed",
        operationId: "op-sticker"
      })
    },
    live: {
      canAccessChat: (userLookup, chatId) =>
        Promise.resolve(chatId === `chat-${userLookup}`),
      subscribe: () => () => undefined
    },
    ready: () => true
  };
}
