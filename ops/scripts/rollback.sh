#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: rollback.sh <previous-release-id>" >&2
  exit 64
fi

release_id="$1"
if [[ ! "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$ ]]; then
  echo "invalid release id" >&2
  exit 64
fi

target="/opt/maxbridge/releases/${release_id}"
if [[ ! -d "$target" ]]; then
  echo "previous release does not exist" >&2
  exit 66
fi

link_tmp="/opt/maxbridge/.rollback-${release_id}"
ln -s "$target" "$link_tmp"
mv -Tf "$link_tmp" /opt/maxbridge/current
systemctl restart maxbridge-workers.service
systemctl restart maxbridge-api.service
