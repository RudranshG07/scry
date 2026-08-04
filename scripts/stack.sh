#!/usr/bin/env bash
#
# Brings the whole observation pipeline up, or reports what is missing.
#
# The pieces have to start in order and stay together: markets invalidate the
# moment observers are absent, and an engine talking to the in-memory store looks
# healthy while writing nothing to Postgres. Both have happened here by starting
# things one at a time and losing track of one.
set -euo pipefail

cd "$(dirname "$0")/.."

RELAY="${SCRY_MEDIA_ORIGIN:-http://127.0.0.1:8888}"
API="${SCRY_API:-http://127.0.0.1:8080}"
LOGS="${SCRY_LOG_DIR:-/tmp}"

say() { printf '  %-11s %s\n' "$1" "$2"; }

# Only streams the relay is actually serving. Pointing an observer at a path
# with no ingest produces a report with no evidence, which invalidates the
# market just as surely as no observer at all.
ingesting() {
  curl -s --max-time 10 "http://127.0.0.1:${SCRY_MEDIA_API_PORT:-9997}/v3/paths/list" 2>/dev/null |
    python3 -c '
import json, sys
try:
    paths = json.load(sys.stdin)["items"]
except Exception:
    sys.exit(0)
for path in paths:
    if path.get("ready") and path.get("bytesReceived", 0) > 0:
        print(path["name"])
' 2>/dev/null || true
}

status() {
  echo "stack"
  docker ps --format '{{.Names}}' | grep -q mediamtx && say relay up || say relay "DOWN (docker compose up -d mediamtx)"
  lsof -nP -iTCP:8080 -sTCP:LISTEN -t >/dev/null 2>&1 && say api up || say api "DOWN"
  curl -sf -o /dev/null http://localhost:3000/live 2>/dev/null && say frontend up || say frontend "down (npm run dev)"

  # pgrep exits 1 when nothing matches, which under `set -e` would kill this
  # script in exactly the case it exists to report.
  local count
  count=$({ pgrep -f 'scry_vision.worker' || true; } | wc -l | tr -d ' ')
  [ "$count" -gt 0 ] && say observers "$count running" || say observers "NONE — every market will invalidate"

  local streams
  streams=$(ingesting | tr '\n' ' ')
  say ingesting "${streams:-none}"
}

observers() {
  local streams
  streams=$(ingesting)
  if [ -z "$streams" ]; then
    echo "no stream is ingesting; start the relay first" >&2
    return 1
  fi

  # caffeinate wraps the command, so a pattern matching only the module misses
  # the wrapper and leaves the old observer alive. Duplicate readers then split
  # the stream between them and every one of them reports a starved window.
  pkill -f 'scry_vision.worker' 2>/dev/null || true
  pkill -f 'caffeinate .*scry_vision' 2>/dev/null || true
  sleep 2

  local python="${SCRY_PYTHON:-python3}"
  # caffeinate keeps these out of idle sleep. Without it macOS froze the loop
  # for five minutes at a time, and the observer woke after the window had
  # already opened and correctly declined it -- every window, all night.
  local keepawake=""
  command -v caffeinate >/dev/null 2>&1 && keepawake="caffeinate -i"

  for stream in $streams; do
    start_observer() {
      # shellcheck disable=SC2086
      nohup $keepawake env PYTHONPATH=services/vision "$python" -m scry_vision.worker \
        --stream "$stream" --relay "$RELAY" --api "$API" \
        --observer "$1" --role "$2" --poll 10 \
        > "$LOGS/obs-$stream-$1.log" 2>&1 < /dev/null &
    }
    start_observer vision-01 primary_vision
    start_observer verify-01 verification
    say started "$stream (2 observers on the shared ingest)"
  done
}

case "${1:-status}" in
  status) status ;;
  observers) observers && echo && status ;;
  *) echo "usage: $0 [status|observers]" >&2; exit 2 ;;
esac
