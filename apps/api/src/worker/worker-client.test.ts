import { rm } from "node:fs/promises";
import {
  createServer,
  type Server,
  type Socket
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
const serverConnections = new WeakMap<Server, Set<Socket>>();

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
    expect(client.isConnected()).toBe(false);
    await client.connect();
    expect(client.isConnected()).toBe(true);

    await expect(client.request({
      operation: "health.check",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
    })).resolves.toEqual({ healthy: true });

    client.close();
    expect(client.isConnected()).toBe(false);
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

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 3_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("condition was not met");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function startTestServer(
  socketPath: string,
  handler: (
    request: WorkerRequest
  ) => Promise<WorkerResponse> | null,
  initialEvent?: WorkerEvent
): Promise<Server> {
  const server = createServer((socket) => {
    serverConnections.get(server)?.add(socket);
    socket.on("close", () => {
      serverConnections.get(server)?.delete(socket);
    });
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
  serverConnections.set(server, new Set());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return server;
}

describe("WorkerClient reconnection", () => {
  it("recovers after the worker restarts", async () => {
    const socketPath = createSocketPath();
    const respond = (request: WorkerRequest): Promise<WorkerResponse> =>
      Promise.resolve({
        kind: "response",
        requestId: request.requestId,
        ok: true,
        payload: { healthy: true }
      });
    let server = await startTestServer(socketPath, respond);
    const client = new WorkerClient({
      socketPath,
      reconnectDelayMs: 10,
      maxReconnectDelayMs: 20
    });
    const connections: boolean[] = [];
    client.subscribeConnection((connected) => {
      connections.push(connected);
    });
    await client.connect();
    expect(connections).toEqual([true]);

    await expect(client.request({
      operation: "health.check",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
    })).resolves.toEqual({ healthy: true });

    // A deploy takes the worker away and brings it back on the same socket.
    await closeServer(server);
    await waitFor(() => Promise.resolve(connections.includes(false)));
    await rm(socketPath, { force: true });
    server = await startTestServer(socketPath, respond);

    let recovered: unknown;
    await waitFor(async () => {
      try {
        recovered = await client.request({
          operation: "health.check",
          sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
        });
        return true;
      } catch {
        return false;
      }
    });
    expect(recovered).toEqual({ healthy: true });
    expect(connections).toEqual([true, false, true]);

    client.close();
    await closeServer(server);
  });

  it("stops reconnecting once closed", async () => {
    const socketPath = createSocketPath();
    const server = await startTestServer(socketPath, (request) =>
      Promise.resolve({
        kind: "response",
        requestId: request.requestId,
        ok: true,
        payload: {}
      }));
    const client = new WorkerClient({ socketPath, reconnectDelayMs: 10 });
    await client.connect();
    client.close();
    await closeServer(server);

    await expect(client.request({
      operation: "health.check",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
    })).rejects.toThrow("Worker is unavailable");
  });
});

async function closeServer(server: Server): Promise<void> {
  // Closing the server alone leaves established connections open, so the
  // client would never see the worker go away.
  for (const socket of serverConnections.get(server) ?? []) {
    socket.destroy();
  }
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
