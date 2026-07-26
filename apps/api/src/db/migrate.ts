import { readFileSync } from "node:fs";

import type { MaxbridgeDatabase } from "./client.js";

const migrationUrls = [
  new URL("./migrations/001_initial.sql", import.meta.url),
  new URL("./migrations/002_approvals.sql", import.meta.url)
] as const;

export function migrateDatabase(
  database: MaxbridgeDatabase,
  migrationSql?: string
): void {
  const migrations = migrationSql === undefined
    ? migrationUrls.map((url) => readFileSync(url, "utf8"))
    : [migrationSql];
  for (const migration of migrations) {
    database.exec(migration);
  }
}
