import { createHash, randomBytes } from "node:crypto";

import type { UserState } from "@maxbridge/core";

import type { MaxbridgeDatabase } from "./client.js";

export type ApprovalDecision = "allow" | "reject";

export type ApprovalResult = Readonly<{
  userLookup: string;
  state: UserState;
}>;

type PendingApprovalRow = Readonly<{
  user_lookup: string;
  user_state: string;
}>;

export class ApprovalRepository {
  constructor(
    private readonly database: MaxbridgeDatabase,
    private readonly now: () => Date = () => new Date()
  ) {}

  createForUser(userLookup: string): string | null {
    assertUserLookup(userLookup);
    const handle = randomBytes(16).toString("base64url");
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO approval_requests (
        handle_hash,
        user_lookup,
        status,
        created_at
      ) VALUES (?, ?, 'pending', ?)
    `).run(
      hashHandle(handle),
      userLookup,
      this.now().toISOString()
    );
    return result.changes === 1 ? handle : null;
  }

  decide(
    handle: string,
    decision: ApprovalDecision
  ): ApprovalResult | null {
    if (!/^[A-Za-z0-9_-]{22}$/u.test(handle)) {
      return null;
    }
    const nextState: UserState = decision === "allow"
      ? "approved_unbound"
      : "disabled";
    const transaction = this.database.transaction(() => {
      const value = this.database.prepare(`
        SELECT
          approval_requests.user_lookup,
          users.state AS user_state
        FROM approval_requests
        JOIN users
          ON users.lookup_id = approval_requests.user_lookup
        WHERE approval_requests.handle_hash = ?
          AND approval_requests.status = 'pending'
      `).get(hashHandle(handle));
      const row = parsePendingApprovalRow(value);
      if (row === null || row.user_state !== "pending") {
        return null;
      }
      const updatedUser = this.database.prepare(`
        UPDATE users
        SET state = ?, updated_at = ?
        WHERE lookup_id = ? AND state = 'pending'
      `).run(nextState, this.now().toISOString(), row.user_lookup);
      if (updatedUser.changes !== 1) {
        return null;
      }
      this.database.prepare(`
        UPDATE approval_requests
        SET status = 'decided', decision = ?, decided_at = ?
        WHERE handle_hash = ? AND status = 'pending'
      `).run(decision, this.now().toISOString(), hashHandle(handle));
      return {
        userLookup: row.user_lookup,
        state: nextState
      };
    });
    return transaction();
  }
}

function hashHandle(handle: string): string {
  return createHash("sha256").update(
    `maxbridge|approval|v1|${handle}`,
    "utf8"
  ).digest("base64url");
}

function assertUserLookup(value: string): void {
  if (!/^u_[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new TypeError("Invalid user lookup");
  }
}

function parsePendingApprovalRow(
  value: unknown
): PendingApprovalRow | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Invalid approval row");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row["user_lookup"] !== "string"
    || typeof row["user_state"] !== "string"
  ) {
    throw new TypeError("Invalid approval row");
  }
  return {
    user_lookup: row["user_lookup"],
    user_state: row["user_state"]
  };
}
