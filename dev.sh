#!/usr/bin/env bash
#
# Bring kde2amiga up locally.
#
#   ./dev.sh          Vite on 5173 with hot reload, API server on 3001 behind it.
#   ./dev.sh --prod   Build both, then serve the built client from the API server on 3001.
#   ./dev.sh --stop   Kill whatever is still holding 3001 or 5173 and exit.
#
# Why this exists rather than `npm run dev`: that script backgrounds the API server with
# `&`, so Ctrl+C stops Vite and leaves the server running on 3001. The next run then dies
# on EADDRINUSE with no hint as to why. Here both halves live in one process group each
# and are torn down together, whichever way the script exits.

set -euo pipefail

# Job control, so each background job becomes its own process group and `kill -- -PID`
# takes the npm wrapper *and* the vite/tsx process it spawns. Without this, killing the
# npm process orphans its child and the port stays held.
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

CLIENT_PORT=5173
SERVER_PORT=3001

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

port_pids() {
  # Every PID listening on $1. `ss -H` keeps the header out; the users:(...) field holds
  # pid=NNN, and one port can legitimately have several (npm wrapper plus its child).
  ss -ltnpH "sport = :$1" 2>/dev/null |
    grep -oP 'pid=\K[0-9]+' | sort -u || true
}

stop_ports() {
  local found=0 port pid
  for port in "$SERVER_PORT" "$CLIENT_PORT"; do
    for pid in $(port_pids "$port"); do
      found=1
      echo "  killing pid $pid on port $port ($(ps -p "$pid" -o comm= 2>/dev/null || echo '?'))"
      kill "$pid" 2>/dev/null || true
    done
  done
  [ "$found" -eq 1 ] || echo "  nothing was listening"
}

wait_for_port() {
  # Poll until something is listening on $1, or $2 seconds pass. A real readiness check
  # rather than a fixed sleep: vite's first start compiles, which is sometimes slow and
  # sometimes instant, so a sleep is wrong in both directions.
  #
  # Asking `ss` for a listener rather than opening a socket, because the two halves do
  # not agree on address family: the API server binds 127.0.0.1 explicitly while vite
  # binds [::1], so a /dev/tcp probe against either literal waits forever on the other.
  local port=$1 timeout=$2 waited=0
  while ! ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; do
    sleep 0.2
    waited=$((waited + 1))
    if [ "$waited" -ge $((timeout * 5)) ]; then
      return 1
    fi
  done
  return 0
}

SERVER_PGID=""
CLIENT_PGID=""

cleanup() {
  trap - EXIT INT TERM
  echo
  bold "Shutting down..."
  for pgid in "$CLIENT_PGID" "$SERVER_PGID"; do
    [ -n "$pgid" ] || continue
    # Negative PID = the whole process group, so vite/tsx go with their npm wrapper.
    kill -- "-$pgid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

# --- argument handling ------------------------------------------------------

MODE=dev
case "${1:-}" in
  --prod) MODE=prod ;;
  --stop)
    bold "Stopping anything on $SERVER_PORT and $CLIENT_PORT"
    stop_ports
    exit 0
    ;;
  --help | -h)
    sed -n '3,7p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
    exit 0
    ;;
  '') ;;
  *) die "Unknown option: $1  (try --help)" ;;
esac

# --- preflight --------------------------------------------------------------

command -v node >/dev/null || die "node is not installed"
command -v npm >/dev/null || die "npm is not installed"

for dir in client server; do
  if [ ! -d "$dir/node_modules" ]; then
    bold "Installing $dir dependencies (first run)"
    npm --prefix "$dir" install
  fi
done

# The Installer binary is served straight out of Installer43_3/ by a Vite plugin, and
# baked into the build. Without it the archive ships no installer and the failure only
# shows up on the Amiga, so say so here instead.
[ -f "Installer43_3/Installer" ] ||
  warn "Installer43_3/Installer is missing — archives will be built without an installer."

busy=""
for port in "$SERVER_PORT" "$CLIENT_PORT"; do
  [ -z "$(port_pids "$port")" ] || busy="$busy $port"
done
if [ -n "$busy" ]; then
  warn "Already in use:$busy"
  warn "That is usually a previous run that outlived its terminal."
  die  "Run './dev.sh --stop' to clear it, then start again."
fi

trap cleanup EXIT INT TERM

# --- run --------------------------------------------------------------------

if [ "$MODE" = prod ]; then
  bold "Building client and server"
  npm run build

  node server/dist/index.js &
  SERVER_PGID=$!

  wait_for_port "$SERVER_PORT" 30 || die "Server never came up on $SERVER_PORT"
  echo
  bold "kde2amiga (built) → http://localhost:$SERVER_PORT"
  echo "Ctrl+C to stop."
  wait
  exit 0
fi

bold "Starting API server on $SERVER_PORT"
npm --prefix server run dev &
SERVER_PGID=$!

wait_for_port "$SERVER_PORT" 30 ||
  die "API server never came up on $SERVER_PORT — see its output above."

bold "Starting Vite on $CLIENT_PORT"
# --strictPort so a busy port is an error rather than a silent hop to 5174, which would
# leave the printed URL wrong.
npm --prefix client run dev -- --strictPort --port "$CLIENT_PORT" &
CLIENT_PGID=$!

wait_for_port "$CLIENT_PORT" 60 ||
  die "Vite never came up on $CLIENT_PORT — see its output above."

echo
bold "kde2amiga → http://localhost:$CLIENT_PORT"
echo "  API server on $SERVER_PORT, proxied at /api"
echo "  Ctrl+C stops both."
echo

# Wait on either job; if one dies, cleanup takes the other down with it.
wait -n
