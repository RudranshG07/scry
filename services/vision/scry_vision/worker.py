"""Runs the observer against the market currently observing on one stream.

An observer watches exactly one camera, and that camera belongs to exactly one
stream. Reporting a count for a market on a different stream would attribute a
reading to a place nobody watched, so the stream is required and every market is
checked against it before a single frame is read.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import UTC, datetime


class StreamMismatch(Exception):
    """The market is not on the stream this observer watches."""


def get(url: str) -> object:
    with urllib.request.urlopen(url, timeout=15) as response:
        return json.loads(response.read())


def pick(markets: list[dict], stream: str, market_id: str | None) -> dict | None:
    """Return the market this observer is entitled to report on, or None."""
    for market in markets:
        if market["status"] != "Observing":
            continue
        if market["streamId"] != stream:
            continue
        if market_id and market["id"] != market_id:
            continue
        return market
    return None


def guard(market: dict, stream: str) -> None:
    if market["streamId"] != stream:
        raise StreamMismatch(
            f"market {market['id']} is on {market['streamId']}, this observer watches {stream}")


def remaining(market: dict) -> float:
    ends = datetime.fromisoformat(market["observationEndsAt"].replace("Z", "+00:00"))
    return (ends - datetime.now(UTC)).total_seconds()


def run(api: str, stream: str, camera: str, market_id: str | None, observer: str,
        role: str, cap: float, poll: float) -> int:
    # Imported here so the pairing logic above stays testable without OpenCV.
    from .observer import horizontal_line, observe, submit

    while True:
        try:
            markets = get(f"{api.rstrip('/')}/v1/markets")
        except Exception as error:  # a restarting API should not kill the observer
            print(f"api unreachable: {error}", file=sys.stderr, flush=True)
            time.sleep(poll)
            continue

        market = pick(markets, stream, market_id)
        if market is None:
            print(f"no window open on {stream}, waiting", flush=True)
            time.sleep(poll)
            continue

        guard(market, stream)

        window = min(cap, remaining(market))
        if window <= 5:
            time.sleep(poll)
            continue

        print(f"observing {market['id']} on {stream} for {window:.0f}s", flush=True)
        result = observe(camera, horizontal_line(), seconds=window)
        print("  " + json.dumps({k: v for k, v in result.items() if k != "counts"}), flush=True)

        status, body = submit(api, market["id"], observer, role, result)
        print(f"  submitted -> {status} {body}", flush=True)

        if market_id:
            return 0 if status == 202 else 1
        time.sleep(poll)


def main() -> int:
    parser = argparse.ArgumentParser(prog="scry-observer")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--stream", required=True,
                        help="stream id this camera belongs to; markets on any other stream are ignored")
    parser.add_argument("--camera", required=True, help="HLS url to watch")
    parser.add_argument("--market", help="observe one market then exit")
    parser.add_argument("--observer", default="vision-01")
    parser.add_argument("--role", default="primary_vision",
                        choices=["edge", "primary_vision", "verification"])
    parser.add_argument("--max-seconds", type=float, default=120,
                        help="cap on one observation, so a long window still reports")
    parser.add_argument("--poll", type=float, default=15)
    args = parser.parse_args()

    try:
        return run(args.api, args.stream, args.camera, args.market, args.observer,
                   args.role, args.max_seconds, args.poll)
    except StreamMismatch as error:
        print(f"refusing to report: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
