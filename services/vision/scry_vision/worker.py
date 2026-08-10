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

# Statuses that mean this window is over as far as the API is concerned: the
# observation closed (409), the market is gone (404), or the report was rejected
# on its own terms (422). None of them change if the same count is sent again.
SETTLED_REFUSALS = frozenset({404, 409, 422})


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


def serving(playlist: str, timeout: float = 4.0) -> bool:
    """Whether the relay actually has this path, rather than merely being named."""
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(playlist, timeout=timeout) as response:
            return response.status == 200 and b"#EXTM3U" in response.read(64)
    except (urllib.error.URLError, OSError, ValueError):
        return False


def live_camera(stream: str, source: str | None, relay: str | None) -> str | None:
    """A playlist url good right now, preferring the shared relay."""
    if relay:
        relayed = f"{relay.rstrip('/')}/{stream}/index.m3u8"
        if serving(relayed):
            return relayed
    if source:
        from .probe import resolve

        return resolve(source)
    return None


def claim_of(market: dict, stream: str):
    """What this market counts, defaulting to whatever crosses the line."""
    from .claims import Claim

    raw = market.get("claim") or {}
    return Claim(
        stream_id=stream,
        kind=raw.get("kind", "crossings"),
        target=raw.get("target", "anything"),
        options=raw.get("options") or {},
    )


def as_report(reading, seconds: float) -> dict:
    """Shape a reading the way the API expects a report.

    uptime and evidenceRoot come from the reading. Reporting a flat 1.0 told the
    resolver every window was fully observed, which is exactly the check that
    stops a count taken over half a window from settling a market, and an empty
    root left nothing for anyone to verify the result against afterwards.
    """
    return {
        "ok": True,
        "count": reading.count,
        "uptime": reading.uptime,
        "visibility": reading.samples[-1]["streamQuality"] if reading.samples else 1.0,
        "frozenSeconds": 0.0,
        "frames": reading.detail.get("frames", 0),
        "elapsed": seconds,
        "modelVersion": reading.detail.get("model", "unknown"),
        "evidenceRoot": reading.evidence_root,
        # What the camera was looking at. The API refuses a count taken on a
        # scene the stream was not qualified on, which both observers would
        # otherwise agree about perfectly.
        "sceneHash": reading.detail.get("sceneHash", ""),
        "counts": reading.samples,
    }


def slot(market: dict, cap: float) -> tuple[datetime, datetime]:
    """The stretch of time every observer on this market counts, so two counts
    cover the same seconds and are comparable."""
    starts = at(market, "observationStartsAt")
    ends = at(market, "observationEndsAt")
    return starts, min(ends, starts + timedelta(seconds=cap))


def run(api: str, stream: str, camera: str, market_id: str | None, observer: str,
        role: str, cap: float, poll: float, source: str | None = None,
        relay: str | None = None) -> int:
    # Imported here so the pairing logic above stays testable without OpenCV.
    import scry_vision  # noqa: F401  registers the observers
    from .claims import Claim, observer_for
    from .observer import submit

    print(f"watching {stream} as {role}", flush=True)
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

        # Resolved per window, not once at startup. A signed playlist expires,
        # and the observer went on watching the dead url: frames stopped
        # arriving, every report came back with a count of zero and no uptime,
        # and every market it touched invalidated with nothing saying why.
        watching = camera
        if source or relay:
            watching = live_camera(stream, source, relay) or camera

        left = (closes - now).total_seconds()
        print(f"observing {market['id']} on {stream} for {left:.0f}s as {role}", flush=True)
        claim = claim_of(market, stream)
        watcher = observer_for(claim)
        if watcher is None:
            # Nothing here can count this, and guessing with the nearest
            # observer would settle the market on the wrong thing entirely.
            print(f"no observer for {claim.label}, skipping {market['id']}", flush=True)
            done.add(market["id"])
            continue

        reading = watcher.observe(watching, claim, left, role)
        result = as_report(reading, left)
        print("  " + json.dumps({k: v for k, v in result.items() if k != "counts"}), flush=True)

        status, body = submit(api, market["id"], observer, role, result)
        print(f"  submitted -> {status} {body}", flush=True)

        # A refusal the market itself will never take back is finished with, not
        # worth retrying. Counting a whole window again to be told the same thing
        # costs fifteen minutes, which is the next window: one late report used
        # to invalidate every market after it.
        if status == 202 or status in SETTLED_REFUSALS:
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

    # The relay is preferred, not imposed. Two observers reading it get identical
    # frames, which keeps any disagreement in the detector rather than in which
    # traffic each one happened to see. But it used to overwrite a camera that
    # had already been resolved, so with the relay down the observers spent ten
    # days watching a url that served nothing, reporting zero counts and zero
    # uptime, and every market they touched invalidated.
    if args.relay:
        relayed = f"{args.relay.rstrip('/')}/{args.stream}/index.m3u8"
        if serving(relayed):
            camera = relayed
        elif camera:
            print(f"relay not serving {args.stream}, watching the source directly", flush=True)
        else:
            parser.error(f"the relay is not serving {args.stream} and no source was given")

    if not camera:
        parser.error("give either --camera, --youtube or a relay that is serving")

    try:
        return run(args.api, args.stream, camera, args.market, args.observer,
                   args.role, args.max_seconds, args.poll,
                   source=args.youtube, relay=args.relay)
    except StreamMismatch as error:
        print(f"refusing to report: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
