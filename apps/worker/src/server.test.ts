import { stat, rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FrameDecoder,
  parseWorkerMessage
} from "@maxbridge/protocol";

import { WorkerProtocolServer } from "./server.js";

const socketPaths: string[] = [];

afterEach(async () => {
  await Promise.all(socketPaths.splice(0).map(
    (path) => rm(path, { force: true })
  ));
});

describe("WorkerProtocolServer", () => {
  it("creates a permission-restricted Unix socket", async () => {
    const socketPath = createSocketPath();
    const server = new WorkerProtocolServer({
      socketPath,
      handler: (request) => Promise.resolve({
        kind: "response",
        requestId: request.requestId,
        ok: true
      })
    });

    await server.start();

    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    await server.close();
  });

  it("broadcasts validated live events to connected API clients", async () => {
    const socketPath = createSocketPath();
    const server = new WorkerProtocolServer({
      socketPath,
      handler: (request) => Promise.resolve({
        kind: "response",
        requestId: request.requestId,
        ok: true
      })
    });
    await server.start();

    const { connect } = await import("node:net");
    const socket = connect(socketPath);
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const received = new Promise<unknown>((resolve) => {
      const decoder = new FrameDecoder();
      socket.on("data", (chunk) => {
        if (typeof chunk !== "string") {
          const [value] = decoder.push(chunk);
          if (value !== undefined) {
            resolve(parseWorkerMessage(value));
          }
        }
      });
    });
    const event = {
      kind: "event",
      event: "session.event",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
      payload: { sequence: 1 }
    } as const;

    server.broadcast(event);

    await expect(received).resolves.toEqual(event);
    socket.destroy();
    await server.close();
  });
});

function createSocketPath(): string {
  const path = join(
    "/tmp",
    `mb-server-${crypto.randomUUID().slice(0, 8)}.sock`
  );
  socketPaths.push(path);
  return path;
}
