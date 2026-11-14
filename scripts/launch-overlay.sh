#!/usr/bin/env bash
# Start the built overlay on X11 with settings from ~/.config/inlook/env.
# Used by the desktop launcher and run-over-ssh.sh.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HOME/.config/inlook/env"
# shellcheck source=/dev/null
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi
export INLOOK_BACKEND_URL="${INLOOK_BACKEND_URL:-http://127.0.0.1:8000}"
cd "$REPO/overlay"
exec ./node_modules/.bin/electron . --ozone-platform=x11 --enable-transparent-visuals "$@"
