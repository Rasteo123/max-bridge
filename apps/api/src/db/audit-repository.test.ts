import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuditRepository, InvalidAuditEventError } from "./audit-repository.js";
import { openDatabase, type MaxbridgeDatabase } from "./client.js";

let database: MaxbridgeDatabase;
let databasePath: string;
let repository: AuditRepository;

beforeEach(() => {
  databasePath = join(tmpdir(), `maxbridge-audit-${crypto.randomUUID()}.sqlite`);
  database = openDatabase(databasePath);
  repository = new AuditRepository(database);
});

afterEach(async () => {
  database.close();
  await Promise.all([
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`
  ].map((path) => rm(path, { force: true })));
});

describe("AuditRepository", () => {
  it("stores only an allowlisted technical event", () => {
    repository.record({
      actorLookup: "u_synthetic",
      eventCode: "auth.telegram.accepted",
      outcome: "success",
      durationMs: 17,
      occurredAt: "2026-07-26T12:00:00.000Z"
    });

    expect(repository.list()).toEqual([{
      actorLookup: "u_synthetic",
      eventCode: "auth.telegram.accepted",
      outcome: "success",
      durationMs: 17,
      occurredAt: "2026-07-26T12:00:00.000Z"
    }]);
  });

  it("rejects free-form or unknown fields", () => {
    expect(() => {
      repository.record({
        actorLookup: "u_synthetic",
        eventCode: "message.received",
        outcome: "success",
        durationMs: 2,
        occurredAt: "2026-07-26T12:00:00.000Z",
        message: "CANARY_MESSAGE_BODY"
      } as never);
    }).toThrow(InvalidAuditEventError);
  });

  it("rejects content-like event codes", () => {
    expect(() => {
      repository.record({
        actorLookup: "u_synthetic",
        eventCode: "hello from a message",
        outcome: "success",
        durationMs: 2,
        occurredAt: "2026-07-26T12:00:00.000Z"
      });
    }).toThrow(InvalidAuditEventError);
  });

  it("purges events older than 30 days", () => {
    repository.record({
      actorLookup: "u_old",
      eventCode: "worker.restarted",
      outcome: "success",
      durationMs: 20,
      occurredAt: "2026-06-01T00:00:00.000Z"
    });
    repository.record({
      actorLookup: "u_current",
      eventCode: "worker.ready",
      outcome: "success",
      durationMs: 10,
      occurredAt: "2026-07-20T00:00:00.000Z"
    });

    expect(repository.purgeOlderThan("2026-06-26T00:00:00.000Z")).toBe(1);
    expect(repository.list()).toHaveLength(1);
    expect(repository.list()[0]?.actorLookup).toBe("u_current");
  });
});
