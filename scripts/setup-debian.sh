#!/usr/bin/env bash
# Turn a fresh Debian 12/13 (GNOME, X11) laptop into the inLook demo machine.
# Run from the repo copy on the laptop: ./scripts/setup-debian.sh
# Safe to re-run: every step is skipped when already done.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR=24
export PATH="$HOME/.local/bin:$PATH"

log() { printf '\n==> %s\n' "$*"; }
installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }
has_candidate() { apt-cache policy "$1" 2>/dev/null | grep 'Candidate: [^(]' >/dev/null; }
# Debian 13 renamed many libs with a t64 suffix (libasound2 -> libasound2t64).
pick() { if has_candidate "${1}t64"; then echo "${1}t64"; else echo "$1"; fi; }

# 1. Electron runtime libraries.
log "apt runtime libraries"
pkgs=(ca-certificates curl rsync xdg-utils libnss3 libxss1 libgbm1 libxshmfence1 libdrm2 libxtst6
      libnotify4 libsecret-1-0 libuuid1 libxkbfile1
      "$(pick libasound2)" "$(pick libgtk-3-0)" "$(pick libatk-bridge2.0-0)" "$(pick libatk1.0-0)"
      "$(pick libcups2)" "$(pick libglib2.0-0)")
missing=()
for p in "${pkgs[@]}"; do installed "$p" || missing+=("$p"); done
if ((${#missing[@]})); then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends "${missing[@]}"
else
  echo "all present"
fi

# 2. Node from NodeSource.
log "Node $NODE_MAJOR"
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
major="$(node_major || true)"
if [[ "${major:-0}" -ge $NODE_MAJOR ]]; then
  echo "node $(node -v) present"
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 3. uv.
log "uv"
if command -v uv >/dev/null; then
  echo "uv $(uv --version) present"
else
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

# 4. Overlay deps and build.
log "overlay: npm ci + build"
cd "$REPO/overlay"
if [[ node_modules/.package-lock.json -nt package-lock.json ]]; then
  echo "node_modules up to date"
else
  npm ci
fi
# Electron 45 has no postinstall: the binary is only fetched on first use, so npm ci
# can leave node_modules/electron without dist/. Fetch it here (no-op when present),
# whether or not npm ci ran.
electron_bin() { node -e 'process.stdout.write(require("electron"))' 2>/dev/null; }
if ! { bin="$(electron_bin)" && [[ -x "$bin" ]]; }; then
  echo "electron binary missing, fetching"
  node node_modules/electron/install.js
  bin="$(electron_bin)" && [[ -x "$bin" ]] || { echo "ERROR: electron binary still missing after install.js" >&2; exit 1; }
fi
echo "electron binary: $bin"
if [[ -f dist/main/main.js ]] && [[ -z "$(find src package.json tsconfig*.json -newer dist/main/main.js -print -quit)" ]]; then
  echo "dist up to date"
else
  npm run build
fi

# 5. Backend deps (uv sync is a no-op when already in sync).
log "backend: uv sync"
(cd "$REPO/backend" && uv sync)

# 6. Env file and desktop launcher.
log "launcher"
ENV_FILE="$HOME/.config/inlook/env"
if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  echo 'INLOOK_BACKEND_URL=http://127.0.0.1:8000' > "$ENV_FILE"
  echo "created $ENV_FILE"
fi
chmod +x "$REPO/scripts/launch-overlay.sh"
DESKTOP="$HOME/.local/share/applications/inlook.desktop"
mkdir -p "$(dirname "$DESKTOP")"
want="[Desktop Entry]
Type=Application
Name=inLook
Comment=inLook overlay
Exec=$REPO/scripts/launch-overlay.sh
Terminal=false
Categories=Utility;"
if [[ -f "$DESKTOP" && "$(cat "$DESKTOP")" == "$want" ]]; then
  echo "$DESKTOP up to date"
else
  printf '%s\n' "$want" > "$DESKTOP"
  update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
  echo "wrote $DESKTOP"
fi

# 7. Session check.
log "session"
if [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; then
  echo "X11 session OK"
else
  echo "WARNING: session type is '${XDG_SESSION_TYPE:-unknown}', not x11." >&2
  echo "         Log out, pick 'GNOME on Xorg' from the gear icon on the login screen," >&2
  echo "         or set WaylandEnable=false in /etc/gdm3/daemon.conf." >&2
fi

log "done. Start the backend: cd $REPO/backend && uv run uvicorn app.main:app"
