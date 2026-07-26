import { rm } from "node:fs/promises";
import {
  createServer,
  type Server
} from "node:net";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FrameDecoder,
  encodeFrame,
  parseWorkerMessage,
  type WorkerEvent,
  type WorkerRequest,
  type WorkerResponse
} from "@maxbridge/protocol";

import {
  RequestTimeoutError,
  WorkerClient
} from "./worker-client.js";

const socketPaths: string[] = [];

afterEach(async () => {
  await Promise.all(socketPaths.splice(0).map(
    (path) => rm(path, { force: true })
  ));
});

describe("WorkerClient", () => {
  it("correlates a response over a Unix socket", async () => {
    const socketPath = createSocketPath();
    const server = await startTestServer(socketPath, (request) =>
      Promise.resolve({
        kind: "response",
        requestId: request.requestId,
        ok: true,
        payload: { healthy: true }
      }));
    const client = new WorkerClient({ socketPath, requestTimeoutMs: 500 });
    await client.connect();

    await expect(client.request({
      operation: "health.check",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
    })).resolves.toEqual({ healthy: true });

    client.close();
    await closeServer(server);
  });

  it("times out a request with a fixed public error", async () => {
    const socketPath = createSocketPath();
    const server = await startTestServer(socketPath, () => null);
    const client = new WorkerClient({ socketPath, requestTimeoutMs: 10 });
    await client.connect();

    await expect(client.request({
      operation: "health.check",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
    })).rejects.toThrow(RequestTimeoutError);

    client.close();
    await closeServer(server);
  });

  it("delivers worker events without mixing session handles", async () => {
    const socketPath = createSocketPath();
    const event: WorkerEvent = {
      kind: "event",
      event: "session.event",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
      payload: { sequence: 1 }
    };
    const server = await startTestServer(socketPath, () => null, event);
    const client = new WorkerClient({ socketPath, requestTimeoutMs: 500 });
    const received = new Promise<WorkerEvent>((resolve) => {
      client.subscribe(resolve);
    });

    await client.connect();

    await expect(received).resolves.toEqual(event);
    client.close();
    await closeServer(server);
  });
});

function createSocketPath(): string {
  const path = join(
    "/tmp",
    `mb-client-${crypto.randomUUID().slice(0, 8)}.sock`
  );
  socketPaths.push(path);
  return path;
}

async function startTestServer(
  socketPath: string,
  handler: (
    request: WorkerRequest
  ) => Promise<WorkerResponse> | null,
  initialEvent?: WorkerEvent
): Promise<Server> {
  const server = createServer((socket) => {
    if (initialEvent !== undefined) {
      socket.write(encodeFrame(initialEvent));
    }
    const decoder = new FrameDecoder();
    socket.on("data", (chunk) => {
      if (typeof chunk === "string") {
        socket.destroy();
        return;
      }
      for (const value of decoder.push(chunk)) {
        const message = parseWorkerMessage(value);
        if (message.kind !== "request") {
          socket.destroy();
          return;
        }
        const response = handler(message);
        if (response !== null) {
          void response.then((result) => {
            socket.write(encodeFrame(result));
          });
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
