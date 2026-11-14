#!/usr/bin/env bash
# Reset the inLook demo and start everything: stop the overlay and backend, reload the demo data into
# MongoDB, start the backend (fresh, so its 5-minute repeat cache is empty too), rebuild the overlay if its
# source changed, and start it. Run from the repo root on the demo laptop:
#
#   scripts/demo-reset.sh              reset and start
#   scripts/demo-reset.sh --keep-data  restart without reloading the demo data
#   scripts/demo-reset.sh --mock       reset, start, then play the scripted demo scenario (npm run mock demo)
#   scripts/demo-reset.sh --stop       stop the overlay and backend, nothing else
#
# Logs: /tmp/inlook-backend.log, /tmp/inlook-overlay.log. Needs backend/.env (see backend/.env.example) and
# the setup from scripts/setup-debian.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=8000
BACKEND_LOG=/tmp/inlook-backend.log
OVERLAY_LOG=/tmp/inlook-overlay.log
ELECTRON="$REPO/overlay/node_modules/electron/dist/electron"
PY="$REPO/backend/.venv/bin/python"
export DISPLAY="${DISPLAY:-:0}"

seed=1 mock=0 stop_only=0
for arg in "$@"; do
  case "$arg" in
    --keep-data) seed=0 ;;
    --mock) mock=1 ;;
    --stop) stop_only=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '==> %s\n' "$*"; }
# Regex for a path, anchored to the start of a command line: matches only processes that ARE that program,
# never a shell or editor whose command line merely mentions it.
anchored() { printf '^%s' "$(printf '%s' "$1" | sed 's/[][\.*^$+?(){}|]/\\&/g')"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
port_busy() { ss -ltn "sport = :$PORT" | grep -q LISTEN; }

# 1. Stop. SIGKILL on purpose: a normal stop waits for the open mic and HUD connections, so the old
#    backend lingers and the new one cannot take the port.
say "stopping the overlay and backend"
pkill -9 -f "$(anchored "$ELECTRON") " 2>/dev/null || true
pkill -9 -f "$(anchored "$REPO/backend/.venv/bin/python")[0-9.]* .*app\.main:app" 2>/dev/null || true
for _ in $(seq 1 20); do port_busy || break; sleep 0.25; done
port_busy && fail "something else is still listening on port $PORT: $(ss -ltnp "sport = :$PORT" | tail -n +2)"
if ((stop_only)); then say "stopped"; exit 0; fi

[[ -x "$PY" ]] || fail "backend/.venv is missing: run scripts/setup-debian.sh (or 'cd backend && uv sync')"
[[ -f "$REPO/backend/.env" ]] || fail "backend/.env is missing: copy backend/.env.example and fill in the keys"
[[ -x "$ELECTRON" ]] || fail "the Electron binary is missing: run scripts/setup-debian.sh"

# 2. Demo data: clear and reload MongoDB from backend/seed.json.
if ((seed)); then
  say "reloading the demo data"
  (cd "$REPO/backend" && "$PY" -m app.seed 2>&1 | grep -E 'database:|seeded') || fail "app.seed failed: is Atlas reachable?"
fi

# 3. Backend, with dev routes on (npm run mock needs them).
say "starting the backend on port $PORT"
# Redirect the whole group and exec: no helper shell is left holding this script's output open.
(cd "$REPO/backend" && INLOOK_DEV=1 exec setsid "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT") \
  >"$BACKEND_LOG" 2>&1 </dev/null &
disown
health=""
for _ in $(seq 1 40); do
  health="$(curl -sf "http://127.0.0.1:$PORT/health" 2>/dev/null)" && break
  sleep 0.5
done
[[ -n "$health" ]] || fail "the backend did not start; last lines of $BACKEND_LOG:
$(tail -n 15 "$BACKEND_LOG")"
echo "    $health"
[[ "$health" == *'"database":"connected"'* ]] || echo "    WARNING: no database for this run (checks and reviews answer 503). Is the laptop's IP on the Atlas access list?" >&2

# 4. Overlay: rebuild when the source is newer than the build (for example after a git pull).
cd "$REPO/overlay"
if [[ ! -f dist/main/main.js ]] || [[ -n "$(find src package.json -newer dist/main/main.js -print -quit)" ]]; then
  say "building the overlay"
  npm run --silent build >/dev/null || fail "overlay build failed: run 'cd overlay && npm run build' to see why"
fi
say "starting the overlay"
setsid "$REPO/scripts/launch-overlay.sh" >"$OVERLAY_LOG" 2>&1 </dev/null &
disown
sleep 4
pgrep -f "$(anchored "$ELECTRON") " >/dev/null || fail "the overlay did not start; last lines of $OVERLAY_LOG:
$(tail -n 15 "$OVERLAY_LOG")"
grep -h 'hotkey .* is taken' "$OVERLAY_LOG" | sed 's/^/    WARNING: /' >&2 || true

if ((mock)); then
  say "playing the scripted demo scenario"
  npm run --silent mock demo
fi

say "ready. Mic: click the eye ball, then the microphone bubble. Hotkeys: check Ctrl+Alt+K, accept Ctrl+Alt+A, reject Ctrl+Alt+R"
echo "    logs: $BACKEND_LOG, $OVERLAY_LOG"
