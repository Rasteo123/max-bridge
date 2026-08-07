import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NotificationPreferences } from "../db/users-repository.js";
import { registerNotificationRoutes } from "./notifications.js";

let app: FastifyInstance;
let stored: NotificationPreferences;

beforeEach(async () => {
  stored = { enabled: true, mutedChatIds: [], previewChatIds: [] };
  app = Fastify({ logger: false });
  await app.register(registerNotificationRoutes, {
    gateway: {
      load: () => Promise.resolve(stored),
      save: (_userLookup, preferences) => {
        stored = preferences;
        return Promise.resolve();
      }
    },
    resolvePrincipal: (request) =>
      request.headers["x-user"] === undefined
        ? null
        : { userLookup: "u_0123456789abcdef", userState: "active" as const }
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const signedIn = { "x-user": "yes" };

describe("notification preference routes", () => {
  it("requires a session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/notifications"
    });

    expect(response.statusCode).toBe(401);
  });

  it("mutes and unmutes one chat without touching the others", async () => {
    stored = {
      enabled: true,
      mutedChatIds: ["chat-2"],
      previewChatIds: ["chat-3"]
    };

    const muted = await app.inject({
      method: "PUT",
      url: "/api/notifications/chats/chat-1",
      headers: signedIn,
      payload: { muted: true }
    });
    expect(muted.statusCode).toBe(200);
    expect(muted.json()).toEqual({
      enabled: true,
      mutedChatIds: ["chat-2", "chat-1"],
      previewChatIds: ["chat-3"]
    });

    const unmuted = await app.inject({
      method: "PUT",
      url: "/api/notifications/chats/chat-2",
      headers: signedIn,
      payload: { muted: false }
    });
    expect(unmuted.json()).toMatchObject({ mutedChatIds: ["chat-1"] });
  });

  it("never stores the same chat twice", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.inject({
        method: "PUT",
        url: "/api/notifications/chats/chat-1",
        headers: signedIn,
        payload: { muted: true }
      });
    }

    expect(stored.mutedChatIds).toEqual(["chat-1"]);
  });

  it("turns the bot's notifications off altogether", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/notifications",
      headers: signedIn,
      payload: { enabled: false }
    });

    expect(response.json()).toMatchObject({ enabled: false });
    expect(stored.enabled).toBe(false);
  });

  it("refuses a body it does not recognise", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/notifications/chats/chat-1",
      headers: signedIn,
      payload: { muted: "yes" }
    });

    expect(response.statusCode).toBe(400);
  });

  it("stops at the storage limit rather than growing without bound", async () => {
    stored = {
      enabled: true,
      mutedChatIds: Array.from(
        { length: 250 },
        (_value, index) => `chat-${String(index)}`
      ),
      previewChatIds: []
    };

    const response = await app.inject({
      method: "PUT",
      url: "/api/notifications/chats/one-too-many",
      headers: signedIn,
      payload: { muted: true }
    });

    expect(response.statusCode).toBe(409);
    expect(stored.mutedChatIds).toHaveLength(250);
  });
});
