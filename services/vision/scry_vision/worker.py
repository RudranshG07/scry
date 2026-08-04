"""Runs an observer against the market scheduled on one stream."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import UTC, datetime, timedelta


class StreamMismatch(Exception):
    """The market is not on the stream this observer watches."""


JOIN_GRACE = 20


def get(url: str) -> object:
    with urllib.request.urlopen(url, timeout=15) as response:
        return json.loads(response.read())


# The engine sets Observing after observation_starts_at has passed, so an
# observer that waits for it has already missed the window it must cover.
WATCHABLE = ("Scheduled", "Open", "Locked", "Observing")


def pick(markets: list[dict], stream: str, market_id: str | None) -> dict | None:
    for market in markets:
        if market["status"] not in WATCHABLE:
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
    """The stretch of time every observer on this market counts, so two counts
    cover the same seconds and are comparable."""
    starts = at(market, "observationStartsAt")
    ends = at(market, "observationEndsAt")
    return starts, min(ends, starts + timedelta(seconds=cap))


def run(api: str, stream: str, camera: str, market_id: str | None, observer: str,
        role: str, cap: float, poll: float) -> int:
    # Imported here so the pairing logic above stays testable without OpenCV.
    from .observer import observe, submit
    from .occupancy import occupancy_for
    from .scenes import scene_for

    scene = scene_for(stream)
    print(f"watching {stream}: counting {scene.unit} in view as {role}", flush=True)
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

        if market["id"] in done:
            time.sleep(poll)
            continue

        opens, closes = slot(market, cap)
        now = datetime.now(UTC)
        if now < opens:
            waiting = (opens - now).total_seconds()
            print(f"in position for {market['id']} ({market['status']}), "
                  f"counting starts in {waiting:.0f}s", flush=True)
            time.sleep(min(poll, waiting))
            continue

        # A partial count answers a whole-window question wrongly, so it voids.
        if now > opens + timedelta(seconds=JOIN_GRACE):
            behind = (now - opens).total_seconds()
            print(f"joined {market['id']} {behind:.0f}s after its window opened "
                  f"(grace is {JOIN_GRACE}s), skipping", flush=True)
            done.add(market["id"])
            continue

        left = (closes - now).total_seconds()
        print(f"observing {market['id']} on {stream} for {left:.0f}s as {role}", flush=True)
        result = observe(camera, scene, seconds=left, role=role)
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
    parser.add_argument("--youtube", help="live watch page; its playlist is signed and expires")
    parser.add_argument("--relay", help="shared ingest origin, so observers read identical frames")
    parser.add_argument("--market", help="observe one market then exit")
    parser.add_argument("--observer", default="vision-01")
    parser.add_argument("--role", default="primary_vision",
                        choices=["edge", "primary_vision", "verification"])
    parser.add_argument("--max-seconds", type=float, default=900,
                        help="safety bound on one observation; covers a whole window")
    parser.add_argument("--poll", type=float, default=15)
    args = parser.parse_args()

    camera = args.camera
    if args.youtube:
        from .probe import resolve
        camera = resolve(args.youtube)
        if not camera:
            parser.error(f"could not resolve a live playlist from {args.youtube}")
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
