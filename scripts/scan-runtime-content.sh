#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 ]]; then
  echo "usage: scan-runtime-content.sh <canary> <explicit-path>..." >&2
  exit 64
fi

canary="$1"
shift

if [[ -z "$canary" || "${#canary}" -lt 8 ]]; then
  echo "canary must contain at least 8 characters" >&2
  exit 64
fi

for target in "$@"; do
  if [[ -z "$target" || "$target" == "/" ]]; then
    echo "refusing an empty or root scan target" >&2
    exit 64
  fi
  if [[ ! -e "$target" ]]; then
    continue
  fi
  if rg --hidden --no-messages -a -l -F -- "$canary" "$target" >/dev/null; then
    echo "content canary found in runtime artifacts" >&2
    exit 1
  fi
done

echo "no content canary found"
