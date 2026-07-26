import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { generateKey } from "@maxbridge/core";
import { openDatabase } from "../../apps/api/src/db/client.js";
import { UsersRepository } from "../../apps/api/src/db/users-repository.js";
import { RuntimeMediaStore } from "../../apps/worker/src/media/runtime-media-store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map(
    async (path) => rm(path, { recursive: true, force: true })
  ));
});

describe("no durable content", () => {
  it("stores no message, contact, filename, phone or OTP plaintext in SQLite", async () => {
    const databasePath = join(
      tmpdir(),
      `maxbridge-content-${crypto.randomUUID()}.sqlite`
    );
    cleanupPaths.push(
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`
    );
    const database = openDatabase(databasePath);
    const users = new UsersRepository(database, {
      masterKey: await generateKey(),
      masterKeyId: "test-master",
      lookupKey: await generateKey()
    });
    await users.createPending({
      telegramId: "723456789",
      firstName: "CANARY_CONTACT_NAME"
    });
    await users.saveMaxSession(
      "723456789",
      new TextEncoder().encode(
        "CANARY_PHONE_79990000000 CANARY_OTP_654321 CANARY_COOKIE"
      )
    );
    database.pragma("wal_checkpoint(TRUNCATE)");
    database.close();

    const bytes = await readFiles([
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`
    ]);
    expect(bytes).not.toContain("CANARY_MESSAGE_BODY");
    expect(bytes).not.toContain("CANARY_CONTACT_NAME");
    expect(bytes).not.toContain("CANARY_FILENAME");
    expect(bytes).not.toContain("CANARY_PHONE_79990000000");
    expect(bytes).not.toContain("CANARY_OTP_654321");
    expect(bytes).not.toContain("CANARY_COOKIE");
  });

  it("removes runtime media after completion", async () => {
    const root = join(tmpdir(), `maxbridge-media-${crypto.randomUUID()}`);
    cleanupPaths.push(root);
    const media = new RuntimeMediaStore({
      root,
      allowUnsafeTestRoot: true,
      ttlMs: 20
    });
    await media.putStream(
      "user-safe",
      "CANARY_FILENAME.png",
      "image/png",
      Readable.from([pngBytes()])
    );
    expect(await readdir(root)).toHaveLength(1);

    await media.close();

    expect(await readdir(root)).toHaveLength(0);
  });
});

async function readFiles(paths: readonly string[]): Promise<string> {
  const buffers: Buffer[] = [];
  for (const path of paths) {
    try {
      buffers.push(await readFile(path));
    } catch {
      // Missing WAL/SHM files are expected after a clean checkpoint.
    }
  }
  return Buffer.concat(buffers).toString("latin1");
}

function pngBytes(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d
  ]);
}
