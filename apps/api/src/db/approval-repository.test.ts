import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateKey } from "@maxbridge/core";

import { ApprovalRepository } from "./approval-repository.js";
import { openDatabase, type MaxbridgeDatabase } from "./client.js";
import { UsersRepository } from "./users-repository.js";

let database: MaxbridgeDatabase;
let databasePath: string;
let users: UsersRepository;
let approvals: ApprovalRepository;

beforeEach(async () => {
  databasePath = join(tmpdir(), `maxbridge-approval-${crypto.randomUUID()}.db`);
  database = openDatabase(databasePath);
  users = new UsersRepository(database, {
    masterKey: await generateKey(),
    masterKeyId: "master-test-v1",
    lookupKey: await generateKey()
  });
  approvals = new ApprovalRepository(database);
});

afterEach(async () => {
  database.close();
  await Promise.all([
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`
  ].map((path) => rm(path, { force: true })));
});

describe("ApprovalRepository", () => {
  it("stores only a hash of a random opaque handle", async () => {
    const user = await users.createPending({ telegramId: "123456789" });

    const handle = approvals.createForUser(user.lookupId);

    expect(handle).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const stored = database.prepare(`
      SELECT handle_hash FROM approval_requests
    `).get() as { handle_hash: string };
    expect(stored.handle_hash).not.toBe(handle);
    expect(stored.handle_hash).not.toContain("123456789");
  });

  it("creates only one pending request per user", async () => {
    const user = await users.createPending({ telegramId: "123456789" });

    expect(approvals.createForUser(user.lookupId)).not.toBeNull();
    expect(approvals.createForUser(user.lookupId)).toBeNull();
  });

  it("atomically approves a pending user once", async () => {
    const user = await users.createPending({ telegramId: "123456789" });
    const handle = approvals.createForUser(user.lookupId);
    expect(handle).not.toBeNull();

    expect(approvals.decide(handle ?? "", "allow")).toEqual({
      userLookup: user.lookupId,
      state: "approved_unbound"
    });
    expect(approvals.decide(handle ?? "", "allow")).toBeNull();
    expect(users.findUserByLookup(user.lookupId)?.state)
      .toBe("approved_unbound");
  });
});
