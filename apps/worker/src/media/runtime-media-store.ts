import {
  mkdir,
  open,
  readdir,
  stat,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";

export const RUNTIME_MEDIA_ROOT = "/run/maxbridge/media";

export class RuntimeMediaError extends Error {
  constructor(readonly code:
    | "media_too_large"
    | "media_busy"
    | "media_invalid"
    | "media_store_failed"
  ) {
    super("Media could not be accepted");
    this.name = "RuntimeMediaError";
  }
}

export type RuntimeMediaFile = Readonly<{
  id: string;
  owner: string;
  path: string;
  mimeType: string;
  fileName: string;
  size: number;
  expiresAt: number;
}>;

type StoredMedia = RuntimeMediaFile & Readonly<{
  timer: NodeJS.Timeout;
}>;

export class RuntimeMediaStore {
  private readonly root: string;
  private readonly ttlMs: number;
  private readonly maxFileBytes: number;
  private readonly maxConcurrentPerUser: number;
  private readonly maxConcurrentGlobal: number;
  private readonly files = new Map<string, StoredMedia>();
  private readonly activeByUser = new Map<string, number>();
  private activeGlobal = 0;
  private closed = false;

  constructor(options: Readonly<{
    root?: string;
    allowUnsafeTestRoot?: boolean;
    ttlMs?: number;
    maxFileBytes?: number;
    maxConcurrentPerUser?: number;
    maxConcurrentGlobal?: number;
  }> = {}) {
    this.root = resolve(options.root ?? RUNTIME_MEDIA_ROOT);
    if (
      options.allowUnsafeTestRoot !== true
      && this.root !== RUNTIME_MEDIA_ROOT
    ) {
      throw new RuntimeMediaError("media_invalid");
    }
    this.ttlMs = Math.max(1, options.ttlMs ?? 5 * 60_000);
    this.maxFileBytes = Math.max(
      1,
      options.maxFileBytes ?? 100 * 1024 * 1024
    );
    this.maxConcurrentPerUser = Math.max(
      1,
      options.maxConcurrentPerUser ?? 2
    );
    this.maxConcurrentGlobal = Math.max(
      1,
      options.maxConcurrentGlobal ?? 8
    );
  }

  async putStream(
    owner: string,
    originalName: string,
    _declaredMimeType: string,
    source: Readable
  ): Promise<RuntimeMediaFile> {
    this.assertOwner(owner);
    this.acquire(owner);
    const id = randomBytes(16).toString("base64url");
    const path = resolve(this.root, `${id}.bin`);
    this.assertWithinRoot(path);
    let file: FileHandle | undefined;
    let completed = false;
    const header = Buffer.alloc(32);
    let headerLength = 0;
    let size = 0;

    try {
      await mkdir(this.root, {
        recursive: true,
        mode: 0o700
      });
      file = await open(path, "wx", 0o600);
      for await (const rawChunk of source) {
        if (!(rawChunk instanceof Uint8Array)) {
          throw new RuntimeMediaError("media_invalid");
        }
        const chunk = Buffer.from(
          rawChunk.buffer,
          rawChunk.byteOffset,
          rawChunk.byteLength
        );
        if (
          chunk.byteLength > this.maxFileBytes - size
        ) {
          throw new RuntimeMediaError("media_too_large");
        }
        const headerRemaining = header.byteLength - headerLength;
        if (headerRemaining > 0) {
          const copied = Math.min(headerRemaining, chunk.byteLength);
          chunk.copy(header, headerLength, 0, copied);
          headerLength += copied;
        }
        await writeAll(file, chunk);
        size += chunk.byteLength;
      }
      if (size === 0) {
        throw new RuntimeMediaError("media_invalid");
      }
      await file.close();
      file = undefined;
      const mimeType = sniffMimeType(header.subarray(0, headerLength));
      if (size > categoryLimit(mimeType, this.maxFileBytes)) {
        throw new RuntimeMediaError("media_too_large");
      }
      const expiresAt = Date.now() + this.ttlMs;
      const timer = setTimeout(() => {
        void this.expire(id);
      }, this.ttlMs);
      timer.unref();
      const stored: StoredMedia = {
        id,
        owner,
        path,
        mimeType,
        fileName: normalizeFileName(originalName),
        size,
        expiresAt,
        timer
      };
      this.files.set(id, stored);
      completed = true;
      return publicMediaFile(stored);
    } catch (error: unknown) {
      if (error instanceof RuntimeMediaError) {
        throw error;
      }
      throw new RuntimeMediaError("media_store_failed");
    } finally {
      header.fill(0);
      if (file !== undefined) {
        await file.close().catch(() => undefined);
      }
      if (!completed) {
        await unlink(path).catch(() => undefined);
      }
      this.release(owner);
    }
  }

  /**
   * Deletes cache files older than the TTL. Eviction otherwise runs only off
   * an in-process timer, so every file outlives the worker that wrote it and
   * nothing ever reconciles the directory again: 52 stranded files once filled
   * /run to 100%, after which media stopped being cached at all and every
   * attachment was re-downloaded in full. A live entry is younger than the TTL
   * by construction, so anything older is an orphan even while a sibling store
   * in this process is mid-write.
   */
  async sweepOrphans(): Promise<number> {
    const cutoff = Date.now() - this.ttlMs;
    let names: readonly string[];
    try {
      names = await readdir(this.root);
    } catch {
      return 0;
    }
    let removed = 0;
    await Promise.all(names.map(async (name) => {
      const path = join(this.root, name);
      try {
        const info = await stat(path);
        if (!info.isFile() || info.mtimeMs > cutoff) {
          return;
        }
        await unlink(path);
        removed += 1;
      } catch {
        // A file that vanished under the sweep needs no sweeping.
      }
    }));
    return removed;
  }

  async expire(id: string): Promise<void> {
    const stored = this.files.get(id);
    if (stored === undefined) {
      return;
    }
    this.files.delete(id);
    clearTimeout(stored.timer);
    await unlink(stored.path).catch(() => undefined);
  }

  async removeUser(owner: string): Promise<void> {
    const owned = [...this.files.values()]
      .filter((file) => file.owner === owner)
      .map((file) => file.id);
    await Promise.all(owned.map(async (id) => this.expire(id)));
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await Promise.all(
      [...this.files.keys()].map(async (id) => this.expire(id))
    );
  }

  private acquire(owner: string): void {
    if (this.closed) {
      throw new RuntimeMediaError("media_store_failed");
    }
    const activeForUser = this.activeByUser.get(owner) ?? 0;
    if (
      activeForUser >= this.maxConcurrentPerUser
      || this.activeGlobal >= this.maxConcurrentGlobal
    ) {
      throw new RuntimeMediaError("media_busy");
    }
    this.activeByUser.set(owner, activeForUser + 1);
    this.activeGlobal += 1;
  }

  private release(owner: string): void {
    const active = this.activeByUser.get(owner) ?? 0;
    if (active <= 1) {
      this.activeByUser.delete(owner);
    } else {
      this.activeByUser.set(owner, active - 1);
    }
    this.activeGlobal = Math.max(0, this.activeGlobal - 1);
  }

  private assertOwner(owner: string): void {
    if (
      owner.length < 1
      || owner.length > 128
      || !/^[A-Za-z0-9_-]+$/u.test(owner)
    ) {
      throw new RuntimeMediaError("media_invalid");
    }
  }

  private assertWithinRoot(path: string): void {
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new RuntimeMediaError("media_invalid");
    }
  }
}

function publicMediaFile(stored: StoredMedia): RuntimeMediaFile {
  return {
    id: stored.id,
    owner: stored.owner,
    path: stored.path,
    mimeType: stored.mimeType,
    fileName: stored.fileName,
    size: stored.size,
    expiresAt: stored.expiresAt
  };
}

async function writeAll(file: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await file.write(
      chunk,
      offset,
      chunk.byteLength - offset,
      null
    );
    if (result.bytesWritten <= 0) {
      throw new RuntimeMediaError("media_store_failed");
    }
    offset += result.bytesWritten;
  }
}

function sniffMimeType(header: Uint8Array): string {
  if (matches(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (matches(header, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (ascii(header, 0, 4) === "GIF8") {
    return "image/gif";
  }
  if (ascii(header, 0, 4) === "%PDF") {
    return "application/pdf";
  }
  if (ascii(header, 0, 4) === "OggS") {
    return "audio/ogg";
  }
  if (ascii(header, 4, 4) === "ftyp") {
    return "video/mp4";
  }
  if (matches(header, [0x1a, 0x45, 0xdf, 0xa3])) {
    return "video/webm";
  }
  if (matches(header, [0x50, 0x4b, 0x03, 0x04])) {
    return "application/zip";
  }
  return "application/octet-stream";
}

function matches(
  source: Uint8Array,
  signature: readonly number[]
): boolean {
  return signature.every((byte, index) => source[index] === byte);
}

function ascii(
  source: Uint8Array,
  offset: number,
  length: number
): string {
  return Buffer.from(source.subarray(offset, offset + length))
    .toString("ascii");
}

function categoryLimit(mimeType: string, hardLimit: number): number {
  let category = 50 * 1024 * 1024;
  if (mimeType.startsWith("image/")) {
    category = 20 * 1024 * 1024;
  } else if (mimeType.startsWith("video/")) {
    category = 100 * 1024 * 1024;
  }
  return Math.min(hardLimit, category);
}

function normalizeFileName(value: string): string {
  const rawLeaf = value.split(/[/\\]/u).at(-1) ?? "file";
  let clean = "";
  for (let index = 0; index < rawLeaf.length; index += 1) {
    const code = rawLeaf.charCodeAt(index);
    if (code > 31 && code !== 127) {
      clean += rawLeaf.charAt(index);
    }
  }
  const normalized = clean.trim().slice(0, 255);
  return normalized.length === 0 ? "file" : normalized;
}
