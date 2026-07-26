import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { zeroBuffer } from "@maxbridge/core";

import { buildApp } from "./app.js";
import {
  RepositoryAuthUserGateway
} from "./auth/repository-user-gateway.js";
import { MemorySessionStore } from "./auth/session-store.js";
import {
  createTelegramBot,
  TelegrafTransport
} from "./bot/bot.js";
import {
  SqliteFriendAccessGateway
} from "./bot/sqlite-access-gateway.js";
import { ApprovalRepository } from "./db/approval-repository.js";
import { openDatabase } from "./db/client.js";
import { UsersRepository } from "./db/users-repository.js";
import { listenApi } from "./main.js";
import { NotificationDeduplicator } from "./notifications/deduplicator.js";
import { NotificationRouter } from "./notifications/router.js";
import {
  RuntimeNotificationService
} from "./notifications/runtime-service.js";
import {
  BridgeRuntimeGateway
} from "./runtime/bridge-runtime-gateway.js";
import { WorkerClient } from "./worker/worker-client.js";

type RuntimeSecrets = Readonly<{
  masterKey: Uint8Array;
  lookupKey: Uint8Array;
  botToken: string;
}>;

async function main(): Promise<void> {
  const config = loadConfig();
  const secrets = await loadSecrets();
  const database = openDatabase(config.databasePath);
  const users = new UsersRepository(database, {
    masterKey: secrets.masterKey,
    masterKeyId: "master-v1",
    lookupKey: secrets.lookupKey
  });
  const approvals = new ApprovalRepository(database);
  const worker = new WorkerClient({
    socketPath: config.workerSocket
  });
  await connectWorker(worker);
  const runtime = new BridgeRuntimeGateway({ worker, users });
  const sessions = new MemorySessionStore();
  const bot = createTelegramBot({
    token: secrets.botToken,
    adminTelegramId: config.adminTelegramId,
    miniAppUrl: config.publicOrigin,
    gateway: new SqliteFriendAccessGateway(users, approvals)
  });
  const app = await buildApp({
    services: {
      sessions,
      auth: {
        botToken: secrets.botToken,
        users: new RepositoryAuthUserGateway(users)
      },
      chats: runtime,
      maxLogin: runtime,
      messages: runtime,
      live: runtime,
      ready: () => true
    },
    allowedOrigins: new Set([config.publicOrigin]),
    allowedHosts: new Set([config.publicHost]),
    logger: true,
    webRoot: fileURLToPath(new URL("../../web/dist", import.meta.url))
  });
  await listenApi(app, {
    host: config.host,
    port: config.port
  });

  let stopping = false;
  let botStarted = false;
  let notifications: RuntimeNotificationService | undefined;
  const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    notifications?.stop();
    if (botStarted) {
      bot.stop(signal);
    }
    await app.close();
    worker.close();
    database.close();
    zeroBuffer(secrets.masterKey);
    zeroBuffer(secrets.lookupKey);
  };
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  if (config.botEnabled) {
    notifications = new RuntimeNotificationService({
      source: runtime,
      users,
      router: new NotificationRouter({
        transport: new TelegrafTransport(bot.telegram),
        settings: {
          load: (userLookup) =>
            users.loadNotificationPreferencesByLookup(userLookup)
        },
        deduplicator: new NotificationDeduplicator()
      }),
      onError: (error) => {
        app.log.warn({ err: error }, "MAX notification delivery failed");
      }
    });
    await notifications.start();
    botStarted = true;
    void bot.launch().catch((error: unknown) => {
      app.log.error({ err: error }, "Telegram bot stopped unexpectedly");
      void shutdown("SIGTERM").finally(() => {
        process.exitCode = 1;
      });
    });
  }
}

async function connectWorker(worker: WorkerClient): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await worker.connect();
      return;
    } catch (error: unknown) {
      lastError = error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
    }
  }
  throw lastError;
}

function loadConfig(): Readonly<{
  host: string;
  port: number;
  databasePath: string;
  workerSocket: string;
  publicOrigin: string;
  publicHost: string;
  adminTelegramId: string;
  botEnabled: boolean;
}> {
  const publicOrigin = process.env["MAXBRIDGE_PUBLIC_ORIGIN"]
    ?? "https://max-users.online";
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/") {
    throw new TypeError("Public origin is invalid");
  }
  const adminTelegramId = process.env["MAXBRIDGE_ADMIN_TELEGRAM_ID"];
  if (
    adminTelegramId === undefined
    || !/^[1-9]\d{0,19}$/u.test(adminTelegramId)
  ) {
    throw new TypeError("Admin Telegram id is invalid");
  }
  const port = Number(process.env["MAXBRIDGE_PORT"] ?? "3100");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("API port is invalid");
  }
  return {
    host: process.env["MAXBRIDGE_HOST"] ?? "127.0.0.1",
    port,
    databasePath: process.env["MAXBRIDGE_DATABASE"]
      ?? "/var/lib/maxbridge/maxbridge.sqlite",
    workerSocket: process.env["MAXBRIDGE_WORKER_SOCKET"]
      ?? "/run/maxbridge/worker.sock",
    publicOrigin: origin.origin,
    publicHost: origin.hostname,
    adminTelegramId,
    botEnabled: process.env["MAXBRIDGE_BOT_ENABLED"] === "true"
  };
}

async function loadSecrets(): Promise<RuntimeSecrets> {
  const directory = process.env["CREDENTIALS_DIRECTORY"];
  if (directory === undefined || !directory.startsWith("/run/credentials/")) {
    throw new TypeError("System credentials are unavailable");
  }
  const [masterKey, lookupKey, botTokenBytes] = await Promise.all([
    loadKey(`${directory}/master-key`),
    loadKey(`${directory}/lookup-key`),
    readFile(`${directory}/bot-token`)
  ]);
  try {
    const botToken = botTokenBytes.toString("utf8").trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,80}$/u.test(botToken)) {
      throw new TypeError("Bot token is invalid");
    }
    return { masterKey, lookupKey, botToken };
  } finally {
    botTokenBytes.fill(0);
  }
}

async function loadKey(path: string): Promise<Uint8Array> {
  const encoded = await readFile(path);
  try {
    const key = Buffer.from(encoded.toString("ascii").trim(), "base64url");
    if (key.byteLength !== 32) {
      key.fill(0);
      throw new TypeError("Encryption key is invalid");
    }
    return key;
  } finally {
    encoded.fill(0);
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
