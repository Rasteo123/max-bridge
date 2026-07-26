import type { MaxbridgeDatabase } from "./client.js";

export type AuditOutcome = "success" | "failure" | "denied";

export type AuditEvent = Readonly<{
  actorLookup: string;
  eventCode: string;
  outcome: AuditOutcome;
  durationMs: number;
  occurredAt: string;
}>;

type AuditRow = Readonly<{
  actor_lookup: string;
  event_code: string;
  outcome: string;
  duration_ms: number;
  occurred_at: string;
}>;

const eventKeys = [
  "actorLookup",
  "eventCode",
  "outcome",
  "durationMs",
  "occurredAt"
] as const;

export class InvalidAuditEventError extends Error {
  readonly code = "invalid_audit_event";

  constructor() {
    super("Audit event failed validation");
    this.name = "InvalidAuditEventError";
  }
}

export class AuditRepository {
  constructor(private readonly database: MaxbridgeDatabase) {}

  record(value: AuditEvent): void {
    const event = parseAuditEvent(value);
    this.database.prepare(`
      INSERT INTO audit_events (
        actor_lookup,
        event_code,
        outcome,
        duration_ms,
        occurred_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      event.actorLookup,
      event.eventCode,
      event.outcome,
      event.durationMs,
      event.occurredAt
    );
  }

  list(): AuditEvent[] {
    const rows = this.database.prepare(`
      SELECT
        actor_lookup,
        event_code,
        outcome,
        duration_ms,
        occurred_at
      FROM audit_events
      ORDER BY id ASC
    `).all();
    return rows.map(parseAuditRow);
  }

  purgeOlderThan(cutoff: string): number {
    assertIsoTimestamp(cutoff);
    return this.database.prepare(
      "DELETE FROM audit_events WHERE occurred_at < ?"
    ).run(cutoff).changes;
  }
}

function parseAuditEvent(value: unknown): AuditEvent {
  if (typeof value !== "object" || value === null) {
    throw new InvalidAuditEventError();
  }
  const keys = Object.keys(value);
  if (
    keys.length !== eventKeys.length
    || keys.some((key) => !eventKeys.includes(key as never))
  ) {
    throw new InvalidAuditEventError();
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["actorLookup"] !== "string"
    || !/^u_[A-Za-z0-9_-]{1,128}$/u.test(record["actorLookup"])
    || typeof record["eventCode"] !== "string"
    || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,5}$/u.test(
      record["eventCode"]
    )
    || (
      record["outcome"] !== "success"
      && record["outcome"] !== "failure"
      && record["outcome"] !== "denied"
    )
    || typeof record["durationMs"] !== "number"
    || !Number.isInteger(record["durationMs"])
    || record["durationMs"] < 0
    || typeof record["occurredAt"] !== "string"
  ) {
    throw new InvalidAuditEventError();
  }
  assertIsoTimestamp(record["occurredAt"]);
  return {
    actorLookup: record["actorLookup"],
    eventCode: record["eventCode"],
    outcome: record["outcome"],
    durationMs: record["durationMs"],
    occurredAt: record["occurredAt"]
  };
}

function parseAuditRow(value: unknown): AuditEvent {
  if (typeof value !== "object" || value === null) {
    throw new InvalidAuditEventError();
  }
  const row = value as Partial<AuditRow>;
  return parseAuditEvent({
    actorLookup: row.actor_lookup,
    eventCode: row.event_code,
    outcome: row.outcome,
    durationMs: row.duration_ms,
    occurredAt: row.occurred_at
  });
}

function assertIsoTimestamp(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
  ) {
    throw new InvalidAuditEventError();
  }
}
