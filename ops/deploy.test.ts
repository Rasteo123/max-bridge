import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const apiUnit = new URL("./systemd/maxbridge-api.service", import.meta.url);
const workerUnit = new URL(
  "./systemd/maxbridge-workers.service",
  import.meta.url
);
const tmpfiles = new URL("./tmpfiles/maxbridge.conf", import.meta.url);
const installScript = new URL("./scripts/install.sh", import.meta.url);
const backupScript = new URL(
  "./scripts/backup-encrypted-db.sh",
  import.meta.url
);

describe("hardened deployment artifacts", () => {
  it("runs both services as the restricted maxbridge user", async () => {
    for (const unit of [apiUnit, workerUnit]) {
      const text = await readFile(unit, "utf8");
      expect(text).toContain("User=maxbridge");
      expect(text).toContain("NoNewPrivileges=true");
      expect(text).toContain("PrivateTmp=true");
      expect(text).toContain("ProtectSystem=strict");
      expect(text).toContain("CapabilityBoundingSet=");
      expect(text).toContain(
        "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6"
      );
      expect(text).toContain(
        "ReadWritePaths=/var/lib/maxbridge /run/maxbridge"
      );
      expect(text).not.toContain("/var/tmp");
    }
  });

  it("binds the API to loopback and uses systemd credentials", async () => {
    const text = await readFile(apiUnit, "utf8");
    expect(text).toContain("MAXBRIDGE_HOST=127.0.0.1");
    expect(text).toContain("MAXBRIDGE_PORT=3100");
    expect(text).toContain("LoadCredential=master-key:");
    expect(text).toContain("LoadCredential=lookup-key:");
    expect(text).toContain("LoadCredential=bot-token:");
    expect(text).toContain("MemoryMax=512M");
  });

  it("keeps the three Chromium workers within the server budget", async () => {
    const text = await readFile(workerUnit, "utf8");
    expect(text).toContain("MemoryHigh=2200M");
    expect(text).toContain("MemoryMax=2600M");
    expect(text).toContain("TasksMax=1024");
    expect(text).toContain("PLAYWRIGHT_BROWSERS_PATH=");
  });

  it("places all transient media under /run", async () => {
    const text = await readFile(tmpfiles, "utf8");
    expect(text).toContain("/run/maxbridge/media 0700");
    expect(text).not.toContain("/var/lib/maxbridge/media");
  });

  it("rejects archive traversal and unsafe SQLite backup paths", async () => {
    const install = await readFile(installScript, "utf8");
    const backup = await readFile(backupScript, "utf8");

    expect(install).toContain('entry" == /*');
    expect(install).toContain('entry" == */../*');
    expect(install).toContain("npm ci --omit=dev");
    expect(install).toContain("playwright install chromium");
    expect(install).toContain("cleanup_incomplete_release");
    expect(install).toContain('find "$release_dir" -type d -exec chmod 0755');
    expect(install).toContain('find "$release_dir" -type f -exec chmod 0644');
    expect(backup).toContain("^/[A-Za-z0-9._/-]+$");
  });
});
