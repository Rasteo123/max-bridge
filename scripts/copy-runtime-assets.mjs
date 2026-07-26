import { cp, mkdir } from "node:fs/promises";
import { URL } from "node:url";

const migrationSource = new URL(
  "../apps/api/src/db/migrations/",
  import.meta.url
);
const migrationDestination = new URL(
  "../apps/api/dist/db/migrations/",
  import.meta.url
);

await mkdir(migrationDestination, { recursive: true });
await cp(migrationSource, migrationDestination, {
  recursive: true,
  force: true
});
