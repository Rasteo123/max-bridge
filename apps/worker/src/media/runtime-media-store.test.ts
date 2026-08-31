import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RUNTIME_MEDIA_ROOT,
  RuntimeMediaStore
} from "./runtime-media-store.js";

let root: string;
let store: RuntimeMediaStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "maxbridge-media-test-"));
  store = new RuntimeMediaStore({
    root,
    allowUnsafeTestRoot: true,
    ttlMs: 60_000,
    maxFileBytes: 1_024
  });
});

afterEach(async () => {
  await store.close();
  await rm(root, { recursive: true, force: true });
});

describe("runtime-only media store", () => {
  it("removes files a previous process left behind", async () => {
    // Eviction runs off an in-process setTimeout, so every file outlives the
    // worker that wrote it. Nothing reconciled the directory at startup, and
    // 381 MB of orphans filled /run until media stopped being cached at all.
    const orphan = join(root, "orphan.bin");
    await writeFile(orphan, "stale");
    const staleAt = new Date(Date.now() - 120_000);
    await utimes(orphan, staleAt, staleAt);
    const live = join(root, "live.bin");
    await writeFile(live, "fresh");

    const removed = await store.sweepOrphans();

    expect(removed).toBe(1);
    await expect(stat(orphan)).rejects.toThrow();
    await expect(stat(live)).resolves.toBeDefined();
  });

  it("uses /run/maxbridge/media in production", () => {
    expect(RUNTIME_MEDIA_ROOT).toBe("/run/maxbridge/media");
    expect(() => new RuntimeMediaStore({
      root: "/tmp/not-runtime-media"
    })).toThrow();
  });

  it("sniffs MIME from bytes, normalizes names and streams mode-0600 files", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("synthetic")
    ]);

    const result = await store.putStream(
      "user-safe",
      "../unsafe/not-an-image.txt",
      "text/plain",
      Readable.from([png.subarray(0, 4), png.subarray(4)])
    );

    expect(result).toMatchObject({
      mimeType: "image/png",
      fileName: "not-an-image.txt",
      size: png.byteLength
    });
    expect(result.path.startsWith(`${root}/`)).toBe(true);
    expect(await readFile(result.path)).toEqual(png);
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
  });

  it("removes files on disconnect and TTL expiry", async () => {
    const first = await store.putStream(
      "user-a",
      "a.pdf",
      "application/pdf",
      Readable.from([Buffer.from("%PDF-1.7 synthetic")])
    );
    const second = await store.putStream(
      "user-b",
      "b.ogg",
      "audio/ogg",
      Readable.from([Buffer.from("OggS synthetic")])
    );

    await store.removeUser("user-a");
    await expect(readFile(first.path)).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(await readFile(second.path)).toBeDefined();

    await store.expire(second.id);
    await expect(readFile(second.path)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("enforces size and per-user concurrency without exposing bytes", async () => {
    const oversized = Buffer.from("PRIVATE_MEDIA_CANARY".repeat(100));

    await expect(store.putStream(
      "user-safe",
      "large.bin",
      "application/octet-stream",
      Readable.from([oversized])
    )).rejects.toMatchObject({
      code: "media_too_large",
      message: "Media could not be accepted"
    });
    try {
      await store.putStream(
        "user-safe",
        "large-again.bin",
        "application/octet-stream",
        Readable.from([oversized])
      );
    } catch (error: unknown) {
      expect(JSON.stringify(error)).not.toContain("PRIVATE_MEDIA_CANARY");
    }
  });

  it("allows at most two concurrent operations per user and globally", async () => {
    await store.close();
    store = new RuntimeMediaStore({
      root,
      allowUnsafeTestRoot: true,
      ttlMs: 60_000,
      maxFileBytes: 1_024,
      maxConcurrentPerUser: 2,
      maxConcurrentGlobal: 2
    });
    const first = new PassThrough();
    const second = new PassThrough();
    const third = new PassThrough();
    const firstUpload = store.putStream(
      "user-a",
      "first.pdf",
      "application/pdf",
      first
    );
    const secondUpload = store.putStream(
      "user-a",
      "second.pdf",
      "application/pdf",
      second
    );

    await expect(store.putStream(
      "user-b",
      "third.pdf",
      "application/pdf",
      third
    )).rejects.toMatchObject({ code: "media_busy" });

    first.end("%PDF first");
    second.end("%PDF second");
    third.destroy();
    await Promise.all([firstUpload, secondUpload]);
  });
});
