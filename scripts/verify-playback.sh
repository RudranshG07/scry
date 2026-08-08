#!/usr/bin/env bash
#
# Plays a market's stream in a real browser and fails if the video does not move.
#
# Manifest checks are not enough on their own. Caltrans served a playlist that
# parsed perfectly while its segments arrived at 0.6 of realtime, so every probe
# called the camera healthy and the player showed a permanent spinner. The only
# question that matters is whether currentTime advances in a browser, so that is
# what this asks.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
APP="${SCRY_APP:-http://localhost:3000}"
API="${SCRY_API:-http://localhost:8080}"
PORT="${SCRY_DEBUG_PORT:-9222}"
PROFILE="$(mktemp -d)"
PROBE="public/__playback-probe.html"
WATCH_SECONDS="${SCRY_WATCH_SECONDS:-40}"

# The probe drives the real page in an iframe rather than rebuilding playback
# around a copy of hls.js: a private player that works proves nothing about the
# one that ships. Same origin, so the video element is readable from outside.
cat > "$PROBE" <<'HTML'
<!doctype html><meta charset="utf-8"><title>probe:starting</title><body></body>
<script>
localStorage.setItem("scry-experience-v1", JSON.stringify({
  acknowledged: true, ageConfirmed: true, jurisdiction: "IN",
  dailyPositionLimit: 100, sessionReminderMinutes: 30, hidePoolValues: false,
  coolOffUntil: null, reminders: [], forecasts: [],
  profile: { displayName: "probe", specialty: "Traffic" },
  readNotifications: [], reactions: {}
}));
const frame = document.createElement("iframe");
frame.width = 1280; frame.height = 720; frame.src = "/live";
document.body.appendChild(frame);
setInterval(() => {
  let videos = [];
  try { videos = Array.from(frame.contentDocument.querySelectorAll("video")); }
  catch (e) { document.title = "probe:no-access"; return; }
  if (!videos.length) { document.title = "probe:no-video"; return; }
  const playing = videos.filter((v) => v.currentTime > 0.5 && v.readyState >= 3);
  const best = playing[0] || videos[0];
  document.title = "probe:" + (playing.length ? "PLAYING" : "waiting") +
    " t=" + best.currentTime.toFixed(2) + " ready=" + best.readyState +
    " res=" + best.videoWidth + "x" + best.videoHeight;
}, 500);
</script>
HTML

cleanup() {
  rm -f "$PROBE"
  pkill -f "$PROFILE" 2>/dev/null || true
  # Chrome still has the profile open the instant it is signalled, and removing
  # it underneath leaves the directory behind with a error nobody can act on.
  wait 2>/dev/null || true
  rm -rf "$PROFILE" 2>/dev/null || true
}
trap cleanup EXIT

curl -sf --max-time 10 "$APP" >/dev/null || { echo "the app is not running at $APP" >&2; exit 1; }
curl -sf --max-time 10 "$API/v1/markets?limit=1" >/dev/null || echo "warning: $API is not answering, the page may have no markets" >&2

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --window-size=1400,900 "$APP/__playback-probe.html" >/dev/null 2>&1 &

WATCH_SECONDS="$WATCH_SECONDS" PORT="$PORT" python3 - <<'PY'
import json, os, re, sys, time, urllib.request

port = os.environ["PORT"]
watch = int(os.environ["WATCH_SECONDS"])

def title():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=4) as response:
            for target in json.load(response):
                if "playback-probe" in target.get("url", ""):
                    return target.get("title", "")
    except Exception:
        return ""
    return ""

def position(text):
    found = re.search(r"t=([0-9.]+)", text)
    return float(found.group(1)) if found else None

deadline = time.time() + watch
first = None
last = ""
while time.time() < deadline:
    last = title()
    if "PLAYING" in last:
        at = position(last)
        if first is None:
            first, started = at, time.time()
        elif time.time() - started >= 15:
            moved, elapsed = at - first, time.time() - started
            print(f"  {last}")
            print(f"  advanced {moved:.1f}s of video in {elapsed:.1f}s of wall clock")
            if moved / elapsed < 0.8:
                print("  FAIL — the video is stalling")
                sys.exit(1)
            print("  PASS — playback is smooth in the browser")
            sys.exit(0)
    time.sleep(1)

print(f"  {last or '(no probe target)'}")
print("  FAIL — the video never started")
sys.exit(1)
PY
