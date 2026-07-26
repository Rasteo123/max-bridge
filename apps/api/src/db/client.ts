import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import { migrateDatabase } from "./migrate.js";

export type MaxbridgeDatabase = Database.Database;

export function openDatabase(path: string): MaxbridgeDatabase {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.pragma("secure_delete = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("trusted_schema = OFF");
  database.pragma("journal_mode = WAL");
  migrateDatabase(database);

  if (path !== ":memory:") {
    chmodSync(path, 0o600);
  }

  return database;
}
