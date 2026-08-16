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

# Streams the API says are worth watching, with the source to watch them on.
#
# This used to ask the relay which paths it was serving, so with the relay down
# it returned nothing, no observer ever started, and every market invalidated
# for ten days with no error anywhere saying why. The API knows which streams
# qualified and what their source is; the relay is an optimisation on top.
ingesting() {
  curl -s --max-time 10 "$API/v1/streams" 2>/dev/null |
    python3 -c '
import json, sys
try:
    streams = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for stream in streams:
    if stream.get("sourceUrl"):
        print(stream["id"] + " " + stream["sourceUrl"])
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
  streams=$(ingesting | awk '{print $1}' | tr '\n' ' ')
  say watchable "${streams:-none}"
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
  # -dims, not -i: -i blocks idle sleep only. This host suspended anyway,
  # and a 500 second sleep came back four hours later with every window
  # in between missed.
  command -v caffeinate >/dev/null 2>&1 && keepawake="caffeinate -dims"

  while read -r stream source; do
    [ -z "$stream" ] && continue
    start_observer() {
      # --youtube as well as --relay: the relay is preferred when it is serving
      # this path and skipped when it is not, rather than blinding the observer.
      # shellcheck disable=SC2086
      nohup $keepawake env PYTHONPATH=services/vision "$python" -m scry_vision.worker \
        --stream "$stream" --youtube "$source" --relay "$RELAY" --api "$API" \
        --observer "$1" --role "$2" --poll 10 \
        > "$LOGS/obs-$stream-$1.log" 2>&1 < /dev/null &
    }
    start_observer vision-01 primary_vision
    start_observer verify-01 verification
    say started "$stream (2 observers)"
  done <<< "$streams"
}

case "${1:-status}" in
  status) status ;;
  observers) observers && echo && status ;;
  *) echo "usage: $0 [status|observers]" >&2; exit 2 ;;
esac
