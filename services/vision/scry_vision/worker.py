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
from datetime import UTC, datetime, timedelta


class StreamMismatch(Exception):
    """The market is not on the stream this observer watches."""


# Slack for polling and clock skew between observers. Wide enough that a healthy
# observer is never shut out of a window it was ready for, narrow enough that the
# seconds it misses cannot move a count.
JOIN_GRACE = 20


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


def at(market: dict, field: str) -> datetime:
    return datetime.fromisoformat(market[field].replace("Z", "+00:00"))


def slot(market: dict, cap: float) -> tuple[datetime, datetime]:
    """The stretch of time every observer on this market must count.

    Two counts are only comparable if they cover the same seconds. Left to pick
    their own, observers drift apart by however long their last pass happened to
    run, and the gap between them is traffic rather than disagreement. The
    window is therefore taken from the market: it starts when observation opens
    and runs for a fixed length, so each observer computes the same pair.
    """
    starts = at(market, "observationStartsAt")
    ends = at(market, "observationEndsAt")
    return starts, min(ends, starts + timedelta(seconds=cap))


def run(api: str, stream: str, camera: str, market_id: str | None, observer: str,
        role: str, cap: float, poll: float) -> int:
    # Imported here so the pairing logic above stays testable without OpenCV.
    from .observer import PROFILES, horizontal_line, observe, submit

    profile = PROFILES[role]
    done: set[str] = set()

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

        # One report per market. Counting it again would replace a full window
        # with whatever the last few seconds happened to hold.
        if market["id"] in done:
            time.sleep(poll)
            continue

        opens, closes = slot(market, cap)
        now = datetime.now(UTC)
        if now < opens:
            time.sleep(min(poll, (opens - now).total_seconds()))
            continue

        if now > opens + timedelta(seconds=JOIN_GRACE):
            # The market asks how many crossed during its window. An observer
            # that arrives late can only count part of it, and a part counted
            # against a whole-window threshold is a wrong answer rather than a
            # partial one. Better the market voids and refunds.
            print(f"joined {market['id']} too late to cover its window, skipping", flush=True)
            done.add(market["id"])
            continue

        left = (closes - now).total_seconds()
        print(f"observing {market['id']} on {stream} for {left:.0f}s "
              f"as {role} ({profile.name})", flush=True)
        result = observe(camera, horizontal_line(), seconds=left, profile=profile)
        print("  " + json.dumps({k: v for k, v in result.items() if k != "counts"}), flush=True)

        status, body = submit(api, market["id"], observer, role, result)
        print(f"  submitted -> {status} {body}", flush=True)
        if status == 202:
            done.add(market["id"])

        if market_id:
            return 0 if status == 202 else 1
        time.sleep(poll)


def main() -> int:
    parser = argparse.ArgumentParser(prog="scry-observer")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--stream", required=True,
                        help="stream id this camera belongs to; markets on any other stream are ignored")
    parser.add_argument("--camera", help="HLS url to watch; omit when using --relay")
    parser.add_argument("--relay",
                        help="origin of the shared ingest, e.g. http://127.0.0.1:8888. "
                             "Observers on one stream then read identical frames, so a "
                             "difference in their counts is the detector rather than the "
                             "network dealing them different footage")
    parser.add_argument("--market", help="observe one market then exit")
    parser.add_argument("--observer", default="vision-01")
    parser.add_argument("--role", default="primary_vision",
                        choices=["edge", "primary_vision", "verification"])
    parser.add_argument("--max-seconds", type=float, default=900,
                        help="safety bound on one observation; the default covers a "
                             "whole window, because a market asks how many crossed "
                             "during the window and a partial count answers nothing")
    parser.add_argument("--poll", type=float, default=15)
    args = parser.parse_args()

    camera = args.camera
    if args.relay:
        camera = f"{args.relay.rstrip('/')}/{args.stream}/index.m3u8"
    if not camera:
        parser.error("give either --camera or --relay")

    try:
        return run(args.api, args.stream, camera, args.market, args.observer,
                   args.role, args.max_seconds, args.poll)
    except StreamMismatch as error:
        print(f"refusing to report: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
