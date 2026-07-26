import { BrowserPool } from "./pool/browser-pool.js";
import {
  PlaywrightBrowserFactory
} from "./pool/playwright-browser-factory.js";
import { WorkerProtocolServer } from "./server.js";
import {
  PlaywrightSessionFactory
} from "./runtime/playwright-session-factory.js";
import {
  WorkerRuntimeRequestHandler
} from "./runtime/request-handler.js";

const socketPath = process.env["MAXBRIDGE_WORKER_SOCKET"]
  ?? "/run/maxbridge/worker.sock";

const pool = new BrowserPool({
  factory: new PlaywrightBrowserFactory()
});
const runtime = new WorkerRuntimeRequestHandler({
  factory: new PlaywrightSessionFactory(pool),
  healthy: () => true,
  emitEvents: (sessionHandle, events) => {
    for (const event of events) {
      server.broadcast({
        kind: "event",
        event: "session.event",
        sessionHandle,
        payload: event
      });
    }
  }
});
const server = new WorkerProtocolServer({
  socketPath,
  handler: runtime.handle
});

async function main(): Promise<void> {
  await pool.start();
  await server.start();
  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });
}

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  await server.close();
  await runtime.close();
  await pool.close();
  process.exitCode = 0;
}

void main().catch(() => {
  process.exitCode = 1;
});
