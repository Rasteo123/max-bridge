import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateKey } from "@maxbridge/core";

import { openDatabase, type MaxbridgeDatabase } from "./client.js";
import {
  InvalidUserTransitionError,
  UsersRepository
} from "./users-repository.js";

const testPaths: string[] = [];
let database: MaxbridgeDatabase;
let databasePath: string;
let repository: UsersRepository;

beforeEach(async () => {
  databasePath = join(tmpdir(), `maxbridge-${crypto.randomUUID()}.sqlite`);
  testPaths.push(databasePath, `${databasePath}-wal`, `${databasePath}-shm`);
  database = openDatabase(databasePath);
  repository = new UsersRepository(database, {
    masterKey: await generateKey(),
    masterKeyId: "master-test-v1",
    lookupKey: await generateKey()
  });
});

afterEach(async () => {
  database.close();
  await Promise.all(testPaths.splice(0).map(
    (path) => rm(path, { force: true })
  ));
});

describe("UsersRepository", () => {
  it("creates and decrypts a pending Telegram identity", async () => {
    const created = await repository.createPending({
      telegramId: "123456789",
      firstName: "Синтетический пользователь",
      username: "synthetic_user"
    });

    expect(created.state).toBe("pending");
    await expect(repository.findIdentity("123456789")).resolves.toEqual({
      telegramId: "123456789",
      firstName: "Синтетический пользователь",
      username: "synthetic_user"
    });
  });

  it("supports the approved authentication lifecycle", async () => {
    const user = await repository.createPending({ telegramId: "123456789" });

    expect(repository.transition(
      "123456789",
      "approved_unbound"
    )).toMatchObject({ state: "approved_unbound" });
    expect(repository.transition(
      "123456789",
      "authenticating"
    )).toMatchObject({ state: "authenticating" });
    expect(repository.transition(
      "123456789",
      "active"
    )).toMatchObject({ state: "active" });
    expect(repository.listUsersByState("active")).toEqual([
      expect.objectContaining({ lookupId: user.lookupId, state: "active" })
    ]);
    expect(repository.transition(
      "123456789",
      "reauth_required"
    )).toMatchObject({ state: "reauth_required" });
  });

  it("rejects an invalid state transition", async () => {
    await repository.createPending({ telegramId: "123456789" });

    expect(() => {
      repository.transition("123456789", "active");
    }).toThrow(InvalidUserTransitionError);
  });

  it("stores and decrypts MAX storage state", async () => {
    const user = await repository.createPending({ telegramId: "123456789" });
    const storageState = new TextEncoder().encode(
      '{"cookies":[{"name":"CANARY_COOKIE_SECRET"}]}'
    );

    await repository.saveMaxSession("123456789", storageState);

    const restored = await repository.loadMaxSession("123456789");
    expect(restored).not.toBeNull();
    expect(new TextDecoder().decode(restored ?? undefined)).toBe(
      '{"cookies":[{"name":"CANARY_COOKIE_SECRET"}]}'
    );

    await expect(repository.loadMaxSessionByLookup(user.lookupId))
      .resolves.toEqual(restored);
    repository.transitionByLookup(user.lookupId, "approved_unbound");
    repository.transitionByLookup(user.lookupId, "authenticating");
    expect(repository.transitionByLookup(user.lookupId, "active").state)
      .toBe("active");
    repository.clearMaxSessionByLookup(user.lookupId);
    await expect(repository.loadMaxSessionByLookup(user.lookupId))
      .resolves.toBeNull();
  });

  it("does not expose identity or MAX state in raw SQLite files", async () => {
    await repository.createPending({
      telegramId: "987654321",
      firstName: "CANARY_IDENTITY_PLAINTEXT"
    });
    await repository.saveMaxSession(
      "987654321",
      new TextEncoder().encode("CANARY_MAX_SESSION_PLAINTEXT")
    );
    database.pragma("wal_checkpoint(TRUNCATE)");
    database.close();

    const durableBytes = await readExistingFiles([
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`
    ]);

    expect(durableBytes).not.toContain("987654321");
    expect(durableBytes).not.toContain("CANARY_IDENTITY_PLAINTEXT");
    expect(durableBytes).not.toContain("CANARY_MAX_SESSION_PLAINTEXT");
  });

  it("encrypts per-chat notification preferences", async () => {
    const user = await repository.createPending({
      telegramId: "123456789"
    });
    await repository.saveNotificationPreferencesByLookup(user.lookupId, {
      enabled: true,
      mutedChatIds: ["CANARY_MUTED_CHAT"],
      previewChatIds: ["CANARY_PREVIEW_CHAT"]
    });

    await expect(repository.loadNotificationPreferencesByLookup(user.lookupId))
      .resolves.toEqual({
        enabled: true,
        mutedChatIds: ["CANARY_MUTED_CHAT"],
        previewChatIds: ["CANARY_PREVIEW_CHAT"]
      });

    database.pragma("wal_checkpoint(TRUNCATE)");
    database.close();
    const durableBytes = await readExistingFiles([
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`
    ]);
    expect(durableBytes).not.toContain("CANARY_MUTED_CHAT");
    expect(durableBytes).not.toContain("CANARY_PREVIEW_CHAT");
  });

  it("deletes the encrypted binding and wrapped key", async () => {
    await repository.createPending({ telegramId: "123456789" });
    await repository.saveMaxSession(
      "123456789",
      new TextEncoder().encode("synthetic-session")
    );

    repository.deleteUser("123456789");

    await expect(repository.findIdentity("123456789")).resolves.toBeNull();
    expect(database.prepare("SELECT COUNT(*) AS count FROM users").get())
      .toEqual({ count: 0 });
  });
});

async function readExistingFiles(paths: readonly string[]): Promise<string> {
  const chunks: Buffer[] = [];
  for (const path of paths) {
    try {
      chunks.push(await readFile(path));
    } catch (error: unknown) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
  return Buffer.concat(chunks).toString("latin1");
}

function isMissingFileError(
  error: unknown
): error is NodeJS.ErrnoException {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}
