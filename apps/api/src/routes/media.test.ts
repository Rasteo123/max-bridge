import { Readable } from "node:stream";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerMediaRoutes,
  type MediaGateway
} from "./media.js";

let app: FastifyInstance;
let gateway: MediaGateway;

beforeEach(async () => {
  gateway = {
    open: vi.fn((userLookup, handle) =>
      Promise.resolve(userLookup === "user-a" && handle === "owned-handle"
        ? {
            stream: Readable.from([Buffer.from("safe-media")]),
            mimeType: "image/png",
            fileName: "picture.png",
            size: 10,
            expiresAt: Date.now() + 60_000
          }
        : null)
    )
  };
  app = Fastify();
  await app.register(registerMediaRoutes, {
    gateway,
    resolvePrincipal: (request) =>
      request.headers["x-test-user"] === "user-a"
        ? { userLookup: "user-a", userState: "active" }
        : request.headers["x-test-user"] === "user-b"
          ? { userLookup: "user-b", userState: "active" }
          : null
  });
});

afterEach(async () => {
  await app.close();
});

describe("media route", () => {
  it("streams short-lived media only to its owning user", async () => {
    const owner = await app.inject({
      method: "GET",
      url: "/api/media/owned-handle",
      headers: { "x-test-user": "user-a" }
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.body).toBe("safe-media");
    expect(owner.headers["cache-control"]).toContain("no-store");

    const other = await app.inject({
      method: "GET",
      url: "/api/media/owned-handle",
      headers: { "x-test-user": "user-b" }
    });
    expect(other.statusCode).toBe(404);
  });

  it("requires an authenticated owner and rejects unsafe handles", async () => {
    expect((await app.inject({
      method: "GET",
      url: "/api/media/owned-handle"
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: "GET",
      url: "/api/media/..%2Fsecret",
      headers: { "x-test-user": "user-a" }
    })).statusCode).toBe(400);
  });
});

describe("saving a file", () => {
  it("tells the browser to save when the viewer asks to download", async () => {
    const inline = await app.inject({
      method: "GET",
      url: "/api/media/owned-handle",
      headers: { "x-test-user": "user-a" }
    });
    expect(inline.headers["content-disposition"]).toContain("inline");

    const saved = await app.inject({
      method: "GET",
      url: "/api/media/owned-handle?download=1",
      headers: { "x-test-user": "user-a" }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers["content-disposition"]).toContain("attachment");
    expect(saved.headers["content-disposition"]).toContain("picture.png");
  });

  it("refuses a download flag it does not understand", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/media/owned-handle?download=yes",
      headers: { "x-test-user": "user-a" }
    });

    expect(response.statusCode).toBe(400);
  });

  it("still guards a saved file by its owner", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/media/owned-handle?download=1",
      headers: { "x-test-user": "user-b" }
    });

    expect(response.statusCode).toBe(404);
  });
});
