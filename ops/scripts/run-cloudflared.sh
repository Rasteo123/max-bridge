#!/usr/bin/env bash
set -euo pipefail

credentials_directory="${CREDENTIALS_DIRECTORY:?systemd credentials are unavailable}"
token_file="${credentials_directory}/tunnel-token"
if [[ ! -r "$token_file" ]]; then
  echo "Cloudflare Tunnel token is unavailable" >&2
  exit 78
fi

exec /usr/bin/cloudflared tunnel --no-autoupdate run \
  --token-file "$token_file"
