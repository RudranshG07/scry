"""Runs an observer against whichever market is next due.

An observer used to be pinned to one stream with --stream. The scheduler opens a
window on every qualified stream, so two observers pinned to one camera left the
rest of them with nobody counting: three streams ran for days, every window
expiring Invalid with no reports at all, while the pair watched the fourth. An
observer is a worker on a queue, not a camera's attendant.
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


JOIN_GRACE = 20

# Below this share of a window there is nothing worth reporting: the resolver's
# uptime floor would refuse it anyway, and counting it costs a whole window.
WORTH_COUNTING = 0.90

# How long before a window opens the observer resolves its playlist, so the
# seconds that matter are spent counting rather than talking to yt-dlp.
#
# Five minutes, not ninety seconds. Resolution takes tens of seconds and
# sometimes more than a minute under load, so warming up at ninety seconds out
# overshot the very boundary it exists to protect: the observer arrived 76s late
# for a grace of twenty, having spent the wait talking to yt-dlp.
WARM_UP = 300

# Woken this far before the window so the last check happens with time in hand.
BOUNDARY_MARGIN = 3.0

# No single sleep longer than this. Far from the window it keeps the observer
# saying where it is; close to it the remaining wait is shorter than this anyway
# and the boundary is still hit in one go.
LONGEST_SLEEP = 60.0

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


def pick(markets: list[dict], stream: str | None, market_id: str | None,
         watchable: set[str] | None = None) -> dict | None:
    """The next window this observer should be counting.

    Soonest first, so an observer free right now takes the window that opens
    next rather than whichever the API happened to list first.
    """
    due = []
    for market in markets:
        if market["status"] not in WATCHABLE:
            continue
        if stream and market["streamId"] != stream:
            continue
        if market_id and market["id"] != market_id:
            continue
        if watchable is not None and market["streamId"] not in watchable:
            continue
        due.append(market)
    if not due:
        return None
    return min(due, key=lambda market: market.get("observationStartsAt") or "")


def guard(market: dict, stream: str | None) -> None:
    if stream and market["streamId"] != stream:
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


# How long to let the relay come up before giving up on it. The relay starts its
# ingest on the first request and closes it again five minutes after the last
# reader leaves, so with windows running back to back it is cold at the start of
# every one of them. Asking once and taking the answer as final sent both
# observers off to run yt-dlp themselves, which took 254 seconds and cost the
# window they were sitting in position for. Waiting is the cheaper end of that
# trade by minutes, and it is one resolution shared by both rather than two.
RELAY_PATIENCE = 150.0
RELAY_RETRY = 5.0


def relay_ready(playlist: str, patience: float = RELAY_PATIENCE) -> bool:
    """Wake the relay's ingest and wait for it to have footage."""
    deadline = time.monotonic() + patience
    announced = False
    while True:
        if serving(playlist):
            return True
        if time.monotonic() >= deadline:
            return False
        if not announced:
            announced = True
            print(f"waiting for the relay to start {playlist}", flush=True)
        time.sleep(RELAY_RETRY)


def sources_from(api: str) -> dict[str, str]:
    """Where each stream can be watched, by stream id.

    Read every pass rather than once at startup: streams are submitted while the
    observer is running, and a signed source is replaced when a channel restarts.
    """
    try:
        streams = get(f"{api.rstrip('/')}/v1/streams")
    except Exception as error:
        print(f"could not list streams: {error}", file=sys.stderr, flush=True)
        return {}
    return {s["id"]: s["sourceUrl"] for s in streams if s.get("sourceUrl")}


def live_camera(stream: str, source: str | None, relay: str | None,
                patience: float = RELAY_PATIENCE) -> str | None:
    """A playlist url good right now, preferring the shared relay."""
    if relay:
        relayed = f"{relay.rstrip('/')}/{stream}/index.m3u8"
        if relay_ready(relayed, patience):
            return relayed
        print(f"the relay never started {stream}, resolving the source directly", flush=True)
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


def run(api: str, stream: str | None, camera: str | None, market_id: str | None,
        observer: str, role: str, cap: float, poll: float, source: str | None = None,
        relay: str | None = None) -> int:
    # Imported here so the pairing logic above stays testable without OpenCV.
    import scry_vision  # noqa: F401  registers the observers
    from .claims import Claim, observer_for
    from .observer import submit

    print(f"observing {stream or 'any stream'} as {role}", flush=True)
    done: set[str] = set()
    warmed: str | None = None
    ready: str | None = None

    while True:
        # A pass round this loop is a few API calls and a sleep. When one takes
        # minutes the observer misses the window it was sitting in position for,
        # and the log says only that it arrived late — so time the pass and name
        # what was slow rather than leaving it to be guessed at again.
        pass_started = time.monotonic()
        try:
            markets = get(f"{api.rstrip('/')}/v1/markets")
        except Exception as error:  # a restarting API should not kill the observer
            print(f"api unreachable: {error}", file=sys.stderr, flush=True)
            time.sleep(poll)
            continue

        # Only take on a stream this observer can actually reach. Without the
        # source list it would pick the soonest window, find no camera for it,
        # and sit out the window it had claimed.
        sources = {stream: source} if stream and source else sources_from(api)
        market = pick(markets, stream, market_id,
                      None if camera else set(sources) | ({stream} if stream else set()))
        if market is None:
            print(f"no window open on {stream or 'any stream'}, waiting", flush=True)
            time.sleep(poll)
            continue

        watching_stream = market["streamId"]
        watching_source = sources.get(watching_stream, source)

        stalled = time.monotonic() - pass_started
        if stalled > 30:
            print(f"that pass took {stalled:.0f}s before any counting started", flush=True)

        guard(market, stream)

        if market["id"] in done:
            time.sleep(poll)
            continue

        opens, closes = slot(market, cap)
        now = datetime.now(UTC)
        if now < opens:
            waiting = (opens - now).total_seconds()
            # Get ready before the window rather than at it. Resolving a signed
            # playlist takes tens of seconds under load, and doing it after the
            # window opened put the observer 77s past a 20s grace on a stream it
            # had been sitting in position for.
            if waiting < WARM_UP and warmed != market["id"]:
                warmed = market["id"]
                ready = (live_camera(watching_stream, watching_source, relay)
                         if (watching_source or relay) else camera)
                # Resolution is not free, so the clock is read again rather than
                # trusting the number from before it.
                waiting = (opens - datetime.now(UTC)).total_seconds()
                print(f"resolved a playlist for {market['id']}, {waiting:.0f}s to go", flush=True)
                if waiting <= 0:
                    continue
            print(f"in position for {market['id']} ({market['status']}), "
                  f"counting starts in {waiting:.0f}s", flush=True)
            # Sleep towards the boundary rather than polling at it — thirty trips
            # round this loop is thirty chances to be descheduled, and the
            # observer kept arriving 60 to 76 seconds late for a twenty second
            # grace. But bounded: one long sleep left it parked in time.sleep
            # for the best part of an hour with nothing in the log, which is a
            # worse failure than being late, because there is nothing to see.
            time.sleep(min(LONGEST_SLEEP, max(0.0, waiting - BOUNDARY_MARGIN)))
            continue
            # Inside the last poll, wait out the remainder and start counting
            # without going round again. Re-reading the market list at the
            # boundary means a stalled call costs the whole window: this
            # observer sat in position, said "89s to go", and arrived 229s late
            # for a grace of twenty.
            time.sleep(max(0.0, waiting))
            now = datetime.now(UTC)

        # A partial count answers a whole-window question wrongly — but that is
        # what uptime is for, and it is a measurement rather than a cliff. The
        # coverage is folded into the report below, so a late join fails the
        # resolver's floor on its own if it missed too much.
        #
        # The cliff was 20 seconds, which nothing on a laptop can promise: this
        # host suspends, and a sleep of 500 seconds came back four hours later.
        # Every window was skipped for arriving 60 to 760 seconds late, when
        # most of them had covered nearly all of the footage that mattered.
        window = (closes - opens).total_seconds()
        behind = max(0.0, (now - opens).total_seconds())
        covered = 1.0 - behind / window if window > 0 else 0.0
        if covered < WORTH_COUNTING:
            print(f"joined {market['id']} {behind:.0f}s into a {window:.0f}s window, "
                  f"only {covered:.0%} of it left, skipping", flush=True)
            done.add(market["id"])
            continue
        if behind > 0:
            print(f"joined {market['id']} {behind:.0f}s late, covering {covered:.0%} "
                  f"of the window", flush=True)

        # Resolved per window, not once at startup. A signed playlist expires,
        # and the observer went on watching the dead url: frames stopped
        # arriving, every report came back with a count of zero and no uptime,
        # and every market it touched invalidated with nothing saying why.
        watching = ready if warmed == market["id"] and ready else camera
        if watching is camera and (watching_source or relay):
            watching = live_camera(watching_stream, watching_source, relay) or camera
        if not watching:
            print(f"nowhere to watch {watching_stream}, skipping {market['id']}", flush=True)
            done.add(market["id"])
            continue

        left = (closes - now).total_seconds()
        print(f"observing {market['id']} on {watching_stream} for {left:.0f}s as {role}", flush=True)
        claim = claim_of(market, watching_stream)
        watcher = observer_for(claim)
        if watcher is None:
            # Nothing here can count this, and guessing with the nearest
            # observer would settle the market on the wrong thing entirely.
            print(f"no observer for {claim.label}, skipping {market['id']}", flush=True)
            done.add(market["id"])
            continue

        reading = watcher.observe(watching, claim, left, role)
        result = as_report(reading, left)
        # Uptime is a share of the market's window, not of the stretch this
        # observer happened to watch. A late join that saw perfect footage for
        # the part it caught has still not covered the question being asked.
        result["uptime"] = round(result["uptime"] * covered, 4)
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
    parser.add_argument("--stream",
                        help="pin to one stream; by default the next window on any stream is taken")
    parser.add_argument("--camera", help="HLS url to watch; omit when using --relay")
    parser.add_argument("--youtube", help="live watch page; its playlist is signed and expires")
    parser.add_argument("--relay", help="shared ingest origin, so observers read identical frames")
    parser.add_argument("--market", help="observe one market then exit")
    parser.add_argument("--observer", default="vision-01")
    parser.add_argument("--role", default="primary_vision",
                        choices=["edge", "primary_vision", "verification"])
    parser.add_argument("--max-seconds", type=float, default=240,
                        help="safety bound on one observation; covers a whole window")
    parser.add_argument("--poll", type=float, default=15)
    args = parser.parse_args()

    camera = args.camera
    if args.youtube:
        from .probe import resolve
        camera = resolve(args.youtube)
        if not camera:
            parser.error(f"could not resolve a live playlist from {args.youtube}")

    # Unpinned, there is nothing to resolve up front: which camera to watch is
    # not known until a window is claimed, and it is looked up then.
    if not args.stream:
        if args.camera or args.youtube:
            parser.error("--camera and --youtube name one camera, so they need --stream")
        try:
            return run(args.api, None, None, args.market, args.observer,
                       args.role, args.max_seconds, args.poll, relay=args.relay)
        except StreamMismatch as error:
            print(f"refusing to report: {error}", file=sys.stderr)
            return 2

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
