#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: backup-encrypted-db.sh <explicit-backup.sqlite>" >&2
  exit 64
fi

source_db="/var/lib/maxbridge/maxbridge.sqlite"
destination="$1"
if [[ "$destination" != /* || "$destination" == "$source_db" ]]; then
  echo "backup destination must be a distinct absolute path" >&2
  exit 64
fi
if [[ ! "$destination" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "backup destination contains unsupported characters" >&2
  exit 64
fi

umask 077
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$source_db" ".timeout 5000" ".backup '${destination}'"
else
  release_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  (
    cd "$release_root"
    node --input-type=module --eval '
      import Database from "better-sqlite3";
      const [source, destination] = process.argv.slice(1);
      const database = new Database(source, {
        fileMustExist: true,
        readonly: true
      });
      try {
        await database.backup(destination);
      } finally {
        database.close();
      }
    ' -- "$source_db" "$destination"
  )
fi
chmod 0600 "$destination"
sha256sum "$destination" >"${destination}.sha256"
chmod 0600 "${destination}.sha256"
