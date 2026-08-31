import { RuntimeMediaStore } from "./media/runtime-media-store.js";
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

// Media eviction runs off per-file timers that die with the process, so a
// restart strands everything the previous worker had cached. Reconcile the
// directory on the way up, then keep checking: a file stranded moments before
// the restart only becomes sweepable once it is older than the TTL.
const mediaSweeper = new RuntimeMediaStore();

async function sweepStrandedMedia(): Promise<void> {
  await mediaSweeper.sweepOrphans().catch(() => undefined);
}

async function main(): Promise<void> {
  await sweepStrandedMedia();
  const sweepTimer = setInterval(() => {
    void sweepStrandedMedia();
  }, 5 * 60_000);
  sweepTimer.unref();
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
