import { createHash, randomBytes } from "node:crypto";

import type { UserState } from "@maxbridge/core";

export type SessionPrincipal = Readonly<{
  userLookup: string;
  userState: UserState;
}>;

export type SessionStoreOptions = Readonly<{
  idleTtlMs?: number;
  now?: () => number;
}>;

export type CreatedSession = Readonly<{
  token: string;
  expiresAt: number;
}>;

type StoredSession = {
  principal: SessionPrincipal;
  expiresAt: number;
};

export class MemorySessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(options: SessionStoreOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? 600_000;
    this.now = options.now ?? Date.now;
  }

  create(principal: SessionPrincipal): CreatedSession {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.idleTtlMs;
    this.sessions.set(hashToken(token), {
      principal: { ...principal },
      expiresAt
    });
    return { token, expiresAt };
  }

  resolve(token: string): SessionPrincipal | null {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return null;
    }
    const tokenHash = hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (session === undefined) {
      return null;
    }
    const now = this.now();
    if (session.expiresAt < now) {
      this.sessions.delete(tokenHash);
      return null;
    }
    session.expiresAt = now + this.idleTtlMs;
    return { ...session.principal };
  }

  destroy(token: string): void {
    this.sessions.delete(hashToken(token));
  }

  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(tokenHash);
        removed += 1;
      }
    }
    return removed;
  }

  debugHasRawToken(token: string): boolean {
    return this.sessions.has(token);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}
