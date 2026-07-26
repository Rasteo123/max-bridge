#!/usr/bin/env bash
set -euo pipefail

curl --fail --silent --show-error \
  --header 'Host: max-users.online' \
  --max-time 5 http://127.0.0.1:3100/health/live >/dev/null
curl --fail --silent --show-error \
  --header 'Host: max-users.online' \
  --max-time 5 http://127.0.0.1:3100/health/ready >/dev/null
systemctl is-active --quiet maxbridge-api.service
systemctl is-active --quiet maxbridge-workers.service

if ss -ltnH 'sport = :3100' | awk '{print $4}' | \
  grep -Ev '^(127\.0\.0\.1|\[::1\]):3100$' >/dev/null; then
  echo "port 3100 is exposed beyond loopback" >&2
  exit 1
fi

ss -ltnuH | grep -E '(:443|:51820)[[:space:]]' >/dev/null
echo "maxbridge health check passed"
