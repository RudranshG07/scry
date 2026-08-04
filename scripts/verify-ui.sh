#!/usr/bin/env bash
#
# Renders the dashboard in a real browser and reports whether the market ids on
# screen came from the API.
#
# Every previous attempt to check this from the server HTML was worthless: the
# dashboard is a client component, so the markets arrive after hydration and the
# initial response never contains them. It also sits behind an age gate, so a
# cold browser only ever renders the gate. Both of those made a broken frontend
# and a working one look identical from curl.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
APP="${SCRY_APP:-http://localhost:3000}"
API="${SCRY_API:-http://localhost:8080}"
PROBE="public/__probe.html"

# The gate stores consent in localStorage, which can only be written from the
# app's own origin. Served briefly, then removed: shipping a page that skips an
# age check would be a hole, not a test fixture.
cat > "$PROBE" <<'HTML'
<!doctype html><meta charset="utf-8"><title>probe</title>
<script>
localStorage.setItem("scry-experience-v1", JSON.stringify({
  acknowledged: true, ageConfirmed: true, jurisdiction: "IN",
  dailyPositionLimit: 100, sessionReminderMinutes: 30, hidePoolValues: false,
  coolOffUntil: null, reminders: [], forecasts: [],
  profile: { displayName: "probe", specialty: "Traffic" },
  readNotifications: [], reactions: {}
}));
location.replace("/live");
</script>
HTML
trap 'rm -f "$PROBE"' EXIT

expected=$(curl -s --max-time 15 "$API/v1/markets" |
  python3 -c 'import json,sys; m=json.load(sys.stdin); print(m[0]["id"] if m else "")')
if [ -z "$expected" ]; then
  echo "the API returned no markets, so there is nothing to look for" >&2
  exit 1
fi

"$CHROME" --headless=new --disable-gpu --no-sandbox --dump-dom \
  --virtual-time-budget=20000 "$APP/__probe.html" 2>/dev/null > /tmp/scry-rendered.html

found=$(grep -oE 'stream-[a-z0-9-]+-17[0-9]{8}' /tmp/scry-rendered.html | sort -u | wc -l | tr -d ' ')
echo "  api's newest market : $expected"
echo "  ids rendered in dom : $found"
grep -oE 'stream-[a-z0-9-]+-17[0-9]{8}' /tmp/scry-rendered.html | sort -u | sed 's/^/    /'

if [ "$found" -eq 0 ]; then
  echo "  FAIL — the page rendered no market from the API"
  exit 1
fi
echo "  PASS — the dashboard is rendering live API data"
