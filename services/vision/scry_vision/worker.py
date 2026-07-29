"""Runs the observer against whatever market is currently observing.

Poll the API, find an open observation window, watch the camera for what is left
of it, submit the count. One process is one observer.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import UTC, datetime

from .observer import horizontal_line, observe, submit


def get(url: str) -> object:
    with urllib.request.urlopen(url, timeout=15) as response:
        return json.loads(response.read())


def observing(api: str) -> list[dict]:
    markets = get(f"{api.rstrip('/')}/v1/markets")
    return [m for m in markets if m["status"] == "Observing"]


def remaining(market: dict) -> float:
    ends = datetime.fromisoformat(market["observationEndsAt"].replace("Z", "+00:00"))
    return (ends - datetime.now(UTC)).total_seconds()


def run(api: str, camera: str, market_id: str | None, observer: str, role: str,
        cap: float, poll: float) -> int:
    while True:
        try:
            open_now = observing(api)
        except Exception as error:  # the API restarting should not kill the observer
            print(f"api unreachable: {error}", file=sys.stderr)
            time.sleep(poll)
            continue

        if market_id:
            open_now = [m for m in open_now if m["id"] == market_id]

        if not open_now:
            print("nothing observing, waiting", flush=True)
            time.sleep(poll)
            continue

        market = open_now[0]
        window = min(cap, remaining(market))
        if window <= 5:
            time.sleep(poll)
            continue

        print(f"observing {market['id']} for {window:.0f}s", flush=True)
        result = observe(camera, horizontal_line(), seconds=window)
        print("  " + json.dumps(result), flush=True)

        status, body = submit(api, market["id"], observer, role, result)
        print(f"  submitted -> {status} {body}", flush=True)

        if market_id:
            return 0 if status == 202 else 1
        time.sleep(poll)


def main() -> int:
    parser = argparse.ArgumentParser(prog="scry-observer")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--camera", required=True, help="HLS url to watch")
    parser.add_argument("--market", help="observe one market then exit")
    parser.add_argument("--observer", default="vision-01")
    parser.add_argument("--role", default="primary_vision",
                        choices=["edge", "primary_vision", "verification"])
    parser.add_argument("--max-seconds", type=float, default=120,
                        help="cap on one observation, so a long window still reports")
    parser.add_argument("--poll", type=float, default=15)
    args = parser.parse_args()

    return run(args.api, args.camera, args.market, args.observer, args.role,
               args.max_seconds, args.poll)


if __name__ == "__main__":
    raise SystemExit(main())
