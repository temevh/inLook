#!/usr/bin/env bash
# Start the built overlay on X11 with settings from ~/.config/inlook/env.
# Used by the desktop launcher and run-over-ssh.sh.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HOME/.config/inlook/env"
# The caller's environment wins: the file only supplies variables that are not already set.
if [[ -f "$ENV_FILE" ]]; then
  declare -A caller_env=()
  for name in $(compgen -e); do caller_env[$name]="${!name}"; done
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
  for name in "${!caller_env[@]}"; do export "$name=${caller_env[$name]}" 2>/dev/null || true; done
fi
export INLOOK_BACKEND_URL="${INLOOK_BACKEND_URL:-http://127.0.0.1:8000}"
cd "$REPO/overlay"
exec ./node_modules/.bin/electron . --ozone-platform=x11 --enable-transparent-visuals "$@"
