#!/usr/bin/env bash
# Start the overlay on the laptop's logged-in X11 display from an SSH shell.
# Run on the laptop: ~/inLook/scripts/run-over-ssh.sh
set -euo pipefail
export DISPLAY="${DISPLAY:-:0}"
if [[ -z "${XAUTHORITY:-}" ]]; then
  # gdm keeps the user's Xauthority in /run/user/<uid>/gdm/Xauthority; fall back to ~/.Xauthority.
  for f in "/run/user/$(id -u)/gdm/Xauthority" "$HOME/.Xauthority"; do
    [[ -f "$f" ]] && { export XAUTHORITY="$f"; break; }
  done
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
exec "$(dirname "${BASH_SOURCE[0]}")/launch-overlay.sh" "$@"
