import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CredentialError,
  loadCredential32
} from "./credentials.js";

const createdDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(createdDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true })
  ));
});

describe("systemd credential loader", () => {
  it("loads an exact 32-byte secret from a private file", async () => {
    const directory = await makeCredentialDirectory();
    await writeFile(join(directory, "master-key"), Buffer.alloc(32, 7), {
      mode: 0o400
    });

    await expect(loadCredential32("master-key", { directory }))
      .resolves.toEqual(new Uint8Array(32).fill(7));
  });

  it("rejects an absent credential", async () => {
    const directory = await makeCredentialDirectory();

    await expect(loadCredential32("master-key", { directory }))
      .rejects.toThrow(CredentialError);
  });

  it("rejects a short credential", async () => {
    const directory = await makeCredentialDirectory();
    await writeFile(join(directory, "master-key"), Buffer.alloc(31), {
      mode: 0o400
    });

    await expect(loadCredential32("master-key", { directory }))
      .rejects.toThrow("must contain exactly 32 bytes");
  });

  it("rejects a group/world-readable fallback file", async () => {
    const directory = await makeCredentialDirectory();
    const path = join(directory, "master-key");
    await writeFile(path, Buffer.alloc(32), { mode: 0o644 });
    await chmod(path, 0o644);

    await expect(loadCredential32("master-key", {
      directory,
      enforcePrivateMode: true
    })).rejects.toThrow("private file mode");
  });

  it("rejects path traversal in a credential name", async () => {
    const directory = await makeCredentialDirectory();

    await expect(loadCredential32("../master-key", { directory }))
      .rejects.toThrow(CredentialError);
  });
});

async function makeCredentialDirectory(): Promise<string> {
  const directory = join(
    tmpdir(),
    `maxbridge-credentials-${randomUUID()}`
  );
  await mkdir(directory, { mode: 0o700 });
  createdDirectories.push(directory);
  return directory;
}
