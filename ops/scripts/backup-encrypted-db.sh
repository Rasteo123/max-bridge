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
sqlite3 "$source_db" ".timeout 5000" ".backup '${destination}'"
chmod 0600 "$destination"
sha256sum "$destination" >"${destination}.sha256"
chmod 0600 "${destination}.sha256"
