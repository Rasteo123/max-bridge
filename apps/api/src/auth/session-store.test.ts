import { describe, expect, it } from "vitest";

import { MemorySessionStore } from "./session-store.js";

describe("MemorySessionStore", () => {
  it("creates a random opaque session and resolves its principal", () => {
    const store = new MemorySessionStore({
      idleTtlMs: 600_000,
      now: () => 1_000
    });

    const first = store.create({
      userLookup: "u_synthetic_a",
      userState: "active"
    });
    const second = store.create({
      userLookup: "u_synthetic_a",
      userState: "active"
    });

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(store.resolve(first.token)).toEqual({
      userLookup: "u_synthetic_a",
      userState: "active"
    });
  });

  it("expires a session after ten idle minutes", () => {
    let now = 1_000;
    const store = new MemorySessionStore({
      idleTtlMs: 600_000,
      now: () => now
    });
    const session = store.create({
      userLookup: "u_synthetic_a",
      userState: "active"
    });
    now += 600_001;

    expect(store.resolve(session.token)).toBeNull();
  });

  it("touches a valid session on use", () => {
    let now = 1_000;
    const store = new MemorySessionStore({
      idleTtlMs: 600_000,
      now: () => now
    });
    const session = store.create({
      userLookup: "u_synthetic_a",
      userState: "active"
    });
    now += 500_000;
    expect(store.resolve(session.token)).not.toBeNull();
    now += 500_000;
    expect(store.resolve(session.token)).not.toBeNull();
  });

  it("destroys a session", () => {
    const store = new MemorySessionStore();
    const session = store.create({
      userLookup: "u_synthetic_a",
      userState: "active"
    });

    store.destroy(session.token);

    expect(store.resolve(session.token)).toBeNull();
  });

  it("does not expose the raw token in its stored keys", () => {
    const store = new MemorySessionStore();
    const session = store.create({
      userLookup: "u_synthetic_a",
      userState: "active"
    });

    expect(store.debugHasRawToken(session.token)).toBe(false);
  });
});
