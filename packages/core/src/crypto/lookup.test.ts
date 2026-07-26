import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createUserLookup,
  generateKey,
  withSecretBuffer,
  zeroBuffer
} from "./index.js";

describe("user lookup", () => {
  it("is stable, keyed and does not expose the Telegram ID", async () => {
    const lookupKey = await generateKey();
    const first = createUserLookup(lookupKey, "123456789");
    const second = createUserLookup(lookupKey, "123456789");

    expect(first).toBe(second);
    expect(first).toMatch(/^u_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain("123456789");
  });

  it("changes when the lookup key changes", async () => {
    const firstKey = await generateKey();
    const secondKey = await generateKey();

    expect(createUserLookup(firstKey, "123456789"))
      .not.toBe(createUserLookup(secondKey, "123456789"));
  });

  it("uses HMAC-SHA-256 with domain separation", () => {
    const key = new Uint8Array(32).fill(7);
    const expected = createHmac("sha256", key)
      .update("maxbridge|telegram-user|v1|123456789", "utf8")
      .digest("base64url");

    expect(createUserLookup(key, "123456789")).toBe(`u_${expected}`);
  });
});

describe("secret buffers", () => {
  it("zeros a buffer explicitly", () => {
    const value = new Uint8Array([1, 2, 3]);
    zeroBuffer(value);
    expect([...value]).toEqual([0, 0, 0]);
  });

  it("zeros its private copy after successful use", async () => {
    let observed: Uint8Array | undefined;

    await withSecretBuffer(new Uint8Array([1, 2, 3]), (secret) => {
      observed = secret;
      expect([...secret]).toEqual([1, 2, 3]);
    });

    expect(observed).toBeDefined();
    expect([...(observed ?? [])]).toEqual([0, 0, 0]);
  });

  it("zeros its private copy after an exception", async () => {
    let observed: Uint8Array | undefined;

    await expect(withSecretBuffer(
      new Uint8Array([4, 5, 6]),
      (secret) => {
        observed = secret;
        throw new Error("synthetic failure");
      }
    )).rejects.toThrow("synthetic failure");

    expect([...(observed ?? [])]).toEqual([0, 0, 0]);
  });
});
