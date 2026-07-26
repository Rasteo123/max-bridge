#!/usr/bin/env bash
set -euo pipefail
umask 022

if [[ "$#" -ne 2 ]]; then
  echo "usage: install.sh <release-id> <verified-archive.tar.gz>" >&2
  exit 64
fi

release_id="$1"
archive="$2"

if [[ ! "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$ ]]; then
  echo "invalid release id" >&2
  exit 64
fi
if [[ ! -f "$archive" ]]; then
  echo "release archive is missing" >&2
  exit 66
fi
while IFS= read -r entry; do
  if [[ "$entry" == /* || "$entry" == ".." || "$entry" == ../* || "$entry" == */../* ]]; then
    echo "release archive contains an unsafe path" >&2
    exit 65
  fi
done < <(tar --list --gzip --file "$archive")
if [[ "$(id -u)" -ne 0 ]]; then
  echo "install must run as root" >&2
  exit 77
fi

release_dir="/opt/maxbridge/releases/${release_id}"
if [[ -e "$release_dir" ]]; then
  echo "release already exists" >&2
  exit 73
fi
activated=0
cleanup_incomplete_release() {
  if [[ "$activated" -eq 0 && -d "$release_dir" ]]; then
    rm -rf -- "$release_dir"
  fi
}
trap cleanup_incomplete_release EXIT

id maxbridge >/dev/null 2>&1 || \
  useradd --system --home-dir /var/lib/maxbridge --shell /usr/sbin/nologin maxbridge
install -d -o root -g root -m 0755 /opt/maxbridge/releases
install -d -o root -g root -m 0755 /opt/maxbridge/browsers
install -d -o maxbridge -g maxbridge -m 0700 /var/lib/maxbridge
install -d -o maxbridge -g maxbridge -m 0750 /run/maxbridge
install -d -o root -g root -m 0700 /etc/maxbridge/credentials
install -d -o root -g root -m 0755 "$release_dir"
tar --extract --gzip --file "$archive" --directory "$release_dir" \
  --no-same-owner --no-same-permissions
find "$release_dir" -type d -exec chmod 0755 {} +
find "$release_dir" -type f -exec chmod 0644 {} +
find "$release_dir/ops/scripts" -type f -exec chmod 0755 {} +
(
  cd "$release_dir"
  npm ci --omit=dev --no-audit --no-fund
  PLAYWRIGHT_BROWSERS_PATH=/opt/maxbridge/browsers \
    npm exec --workspace @maxbridge/worker -- playwright install chromium
)
chown -R root:root "$release_dir"
chmod -R go-w "$release_dir"
chown -R root:root /opt/maxbridge/browsers
chmod -R go-w /opt/maxbridge/browsers

link_tmp="/opt/maxbridge/.current-${release_id}"
ln -s "$release_dir" "$link_tmp"
mv -Tf "$link_tmp" /opt/maxbridge/current
activated=1

install -o root -g root -m 0644 \
  "$release_dir/ops/systemd/maxbridge-api.service" /etc/systemd/system/
install -o root -g root -m 0644 \
  "$release_dir/ops/systemd/maxbridge-workers.service" /etc/systemd/system/
install -o root -g root -m 0644 \
  "$release_dir/ops/systemd/maxbridge.target" /etc/systemd/system/
install -o root -g root -m 0644 \
  "$release_dir/ops/tmpfiles/maxbridge.conf" /etc/tmpfiles.d/
systemd-tmpfiles --create /etc/tmpfiles.d/maxbridge.conf
systemctl daemon-reload
