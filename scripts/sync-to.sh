#!/usr/bin/env bash
# Copy the repo to ~/inLook on the laptop. Usage: ./scripts/sync-to.sh <ssh-host>
set -euo pipefail
[[ $# -eq 1 ]] || { echo "usage: $0 <ssh-host>" >&2; exit 1; }
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rsync -az --delete --info=stats1 \
  --exclude node_modules --exclude dist --exclude .venv --exclude __pycache__ \
  "$REPO/" "$1:inLook/"
