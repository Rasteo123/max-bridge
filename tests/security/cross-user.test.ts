import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  buildApp,
  type AppServices
} from "../../apps/api/src/app.js";
import { MemorySessionStore } from "../../apps/api/src/auth/session-store.js";

let sessions: MemorySessionStore;
let services: AppServices;
let app: Awaited<ReturnType<typeof buildApp>>;
const gatewayCalls: Array<Readonly<{
  userLookup: string;
  chatId: string;
}>> = [];

beforeEach(async () => {
  gatewayCalls.length = 0;
  sessions = new MemorySessionStore();
  services = isolatedServices(sessions);
  app = await buildApp({
    services,
    allowedOrigins: new Set(["https://max-users.online"]),
    allowedHosts: new Set(["localhost", "127.0.0.1"]),
    logger: false
  });
});

afterEach(async () => {
  await app.close();
});

describe("cross-user isolation", () => {
  it("never lets user A read a chat owned by user B", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/chats/chat-b/messages",
      headers: {
        host: "localhost",
        cookie: cookieFor("user-a")
      }
    });

    expect(response.statusCode).toBe(404);
    expect(gatewayCalls).toEqual([{
      userLookup: "user-a",
      chatId: "chat-b"
    }]);
    expect(response.body).not.toContain("user-b");
  });

  it("rejects a WebSocket subscription to another user's chat", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(
      address.replace(/^http/u, "ws") + "/api/ws",
      {
        headers: {
          host: "localhost",
          origin: "https://max-users.online",
          cookie: cookieFor("user-a")
        }
      }
    );
    const ready = waitForMessage(socket);
    await waitForOpen(socket);
    await ready;
    socket.send(JSON.stringify({
      type: "open_chat",
      chatId: "chat-b"
    }));
    const message = await waitForMessage(socket);

    expect(JSON.parse(rawDataText(message))).toEqual({
      type: "error",
      code: "chat_not_found"
    });
    expect(gatewayCalls).toContainEqual({
      userLookup: "user-a",
      chatId: "chat-b"
    });
    socket.close();
  });
});

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

function cookieFor(userLookup: string): string {
  return `__Host-maxbridge_session=${sessions.create({
    userLookup,
    userState: "active"
  }).token}`;
}

function isolatedServices(store: MemorySessionStore): AppServices {
  return {
    sessions: store,
    auth: {
      botToken: "123456:synthetic-bot-token",
      users: { findPrincipal: () => null }
    },
    chats: {
      list: () => Promise.resolve([]),
      history: (userLookup, chatId) => {
        gatewayCalls.push({ userLookup, chatId });
        return Promise.resolve(
          chatId === `chat-${userLookup}` ? [] : null
        );
      }
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
      canAccessChat: (userLookup, chatId) => {
        gatewayCalls.push({ userLookup, chatId });
        return Promise.resolve(chatId === `chat-${userLookup}`);
      },
      subscribe: () => () => undefined
    },
    ready: () => true
  };
}
