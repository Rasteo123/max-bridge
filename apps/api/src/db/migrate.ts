import { readFileSync } from "node:fs";

import type { MaxbridgeDatabase } from "./client.js";

const initialMigrationUrl = new URL(
  "./migrations/001_initial.sql",
  import.meta.url
);

export function migrateDatabase(
  database: MaxbridgeDatabase,
  migrationSql = readFileSync(initialMigrationUrl, "utf8")
): void {
  database.exec(migrationSql);
}
