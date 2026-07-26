import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateKey } from "@maxbridge/core";

import { SqliteFriendAccessGateway } from "./sqlite-access-gateway.js";
import { ApprovalRepository } from "../db/approval-repository.js";
import { openDatabase, type MaxbridgeDatabase } from "../db/client.js";
import { UsersRepository } from "../db/users-repository.js";

let database: MaxbridgeDatabase;
let databasePath: string;
let gateway: SqliteFriendAccessGateway;

beforeEach(async () => {
  databasePath = join(tmpdir(), `maxbridge-gateway-${crypto.randomUUID()}.db`);
  database = openDatabase(databasePath);
  const users = new UsersRepository(database, {
    masterKey: await generateKey(),
    masterKeyId: "master-test-v1",
    lookupKey: await generateKey()
  });
  gateway = new SqliteFriendAccessGateway(
    users,
    new ApprovalRepository(database)
  );
});

afterEach(async () => {
  database.close();
  await Promise.all([
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`
  ].map((path) => rm(path, { force: true })));
});

describe("SqliteFriendAccessGateway", () => {
  it("persists one request and returns the approved Telegram identity", async () => {
    const actor = {
      telegramId: "123456789",
      firstName: "Синтетический"
    };

    const first = await gateway.requestAccess(actor);
    const second = await gateway.requestAccess(actor);
    const decision = await gateway.decide(
      first.requestHandle ?? "",
      "allow"
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(decision).toEqual({
      telegramId: actor.telegramId,
      state: "approved_unbound"
    });
  });
});
