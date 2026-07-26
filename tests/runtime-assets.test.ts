import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("runtime release assets", () => {
  it("copies SQLite migrations as part of every production build", async () => {
    await expect(access(new URL(
      "../apps/api/src/db/migrations/001_initial.sql",
      import.meta.url
    ))).resolves.toBeUndefined();
    await expect(access(new URL(
      "../apps/api/src/db/migrations/002_approvals.sql",
      import.meta.url
    ))).resolves.toBeUndefined();
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8"
    )) as { scripts?: { build?: string } };
    expect(packageJson.scripts?.build).toContain(
      "node scripts/copy-runtime-assets.mjs"
    );
  });
});
