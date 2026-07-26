import { stat, rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
});

function createSocketPath(): string {
  const path = join(
    "/tmp",
    `mb-server-${crypto.randomUUID().slice(0, 8)}.sock`
  );
  socketPaths.push(path);
  return path;
}
