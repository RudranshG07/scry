"""Decides whether a submitted stream can host a market.

Anyone can paste a link, so nothing here may depend on a human choosing a count
line, a subject, or a threshold first. The stream is watched briefly and either
qualifies on its own evidence or is rejected with the reason.

What it has to establish, in order:
  the frames arrive faster than they are produced
  something is visible at all
  two different models see roughly the same thing
  there is enough in view that a count means something
"""

from __future__ import annotations

from .capture import open_capture

import json
import statistics
import sys
from dataclasses import asdict, dataclass

# Segments have to arrive faster than they play or the observer falls behind and
# the tail of the window is never seen. 1.5 leaves half again for jitter. At 3.0
# this bar rejected a camera two observers had just counted 161 crossings on,
# for the crime of delivering at 2.6 — the Caltrans feed that started all this
# managed 0.6 and is still refused decisively.
MIN_REALTIME = 1.5
MIN_SUBJECTS = 3.0
# One subject either way has to move the count by less than the resolver's 5%
# bar, so 25 rather than 20: at exactly 20 a single subject is 5.0%, right on
# the line. Abbey Road at six people put one pedestrian at 17%.
MIN_FOR_PERCENT = 25.0
# Measured, like the settlement tolerance. The two detector profiles differ by
# about 15% per frame on identical footage — the smaller model simply finds
# fewer distant subjects — and occupancy is a per-frame average, so it carries
# that difference plus frame-to-frame noise. At 0.20 this gate rejected a road
# that two observers had counted 161 crossings on. A scene nobody can read still
# fails it: the worst measured here were 40% and 55%.
MAX_DISAGREEMENT = 0.30

# A live playlist opens on the second or third try often enough that one failure
# is no evidence at all about the camera.
OPEN_ATTEMPTS = 3
OPEN_BACKOFF = 3.0


@dataclass
class Verdict:
    url: str
    usable: bool
    reason: str
    counts: str = ""
    subjects: float = 0.0
    peak: int = 0
    disagreement: float = 0.0
    realtime: float = 0.0
    provisional: bool = False
    # The view this verdict was reached on. A market counted on a different
    # scene is not the market that was qualified.
    scene: str = ""
    # What a market on this stream should be set at. Left unset the scheduler
    # falls back to a flat 180 for every camera, so a road that passes a hundred
    # a window settles "no" every single time and the market is decided before
    # it opens.
    threshold: int = 0


def _average(samples: list[int]) -> float:
    return statistics.fmean(samples) if samples else 0.0


OBSERVATION_WINDOW = 15 * 60


def inspect(url: str, seconds: float = 45, claim: dict | None = None,
            window: float = OBSERVATION_WINDOW) -> Verdict:
    """Watch a stream briefly and decide what, if anything, it can count."""
    from .occupancy import Occupancy
    from .probe import resolve, throughput

    playlist = resolve(url)
    if not playlist:
        return Verdict(url, False, "could not find a live stream at that link")

    # Measured twice when the first look is poor. Three segments is a small
    # sample of a variable network: Shibuya came back at 0.8 and 2.2 minutes
    # apart, and the low reading alone would have suspended a camera the counter
    # had just found twenty-three crossings on.
    net = throughput(playlist)
    if net.get("ok") and net["realtime_factor"] < MIN_REALTIME:
        again = throughput(playlist)
        if again.get("ok") and again["realtime_factor"] > net["realtime_factor"]:
            net = again

    if not net.get("ok"):
        return Verdict(url, False, net.get("reason", "unreachable"))
    if net["realtime_factor"] < MIN_REALTIME:
        return Verdict(url, False,
                       f"only {net['realtime_factor']}x real time; needs {MIN_REALTIME}x",
                       realtime=net["realtime_factor"])

    import time

    import cv2

    # Both subjects are counted, so the stream declares what it is rather than
    # the submitter guessing.
    watchers = {
        "people": (Occupancy(role="primary_vision", unit="people"),
                   Occupancy(role="verification", unit="people")),
        "vehicles": (Occupancy(role="primary_vision", unit="vehicles"),
                     Occupancy(role="verification", unit="vehicles")),
    }

    # Retried, because opening a live playlist fails transiently — a segment
    # boundary, a busy CDN, another reader already on the socket. One flaky
    # open used to suspend the camera, and suspension lasts two hours: Bangkok
    # was condemned while yt-dlp could still see it live.
    capture = None
    for attempt in range(OPEN_ATTEMPTS):
        capture = open_capture(playlist)
        if capture.isOpened():
            break
        capture.release()
        capture = None
        if attempt + 1 < OPEN_ATTEMPTS:
            time.sleep(OPEN_BACKOFF)
            playlist = resolve(url) or playlist
    if capture is None:
        return Verdict(url, False, f"the stream would not open in {OPEN_ATTEMPTS} attempts")

    from .scene import background

    started = time.monotonic()
    scene_frames: list = []
    seen_frames = 0
    while time.monotonic() - started < seconds:
        ok, frame = capture.read()
        if not ok:
            continue
        seen_frames += 1
        if len(scene_frames) < 9 and seen_frames % 40 == 0:
            scene_frames.append(frame.copy())
        for primary, verify in watchers.values():
            primary.feed(frame)
            verify.feed(frame)
    capture.release()
    scene_hash = background(scene_frames)

    scored = {
        unit: (_average(primary.samples), _average(verify.samples), primary.peak)
        for unit, (primary, verify) in watchers.items()
    }
    unit, (primary_avg, verify_avg, peak) = max(scored.items(), key=lambda kv: kv[1][0])

    # Empty is not broken. Abbey Road at half past midnight shows nobody and at
    # noon shows a crossing every few seconds, so a single look during quiet
    # hours must not throw the camera out — it comes back provisional, keeps its
    # place, opens no markets, and is looked at again on the next sweep.
    if primary_avg < MIN_SUBJECTS:
        return Verdict(url, True,
                       "nothing much in view right now; subjects may also be too small to read",
                       counts=unit, subjects=round(primary_avg, 1), peak=peak,
                       realtime=net["realtime_factor"], provisional=True)

    lo, hi = sorted((primary_avg, verify_avg))
    disagreement = (hi - lo) / lo if lo else 1.0
    if disagreement > MAX_DISAGREEMENT:
        return Verdict(url, False,
                       f"two models disagree by {disagreement:.0%}; the scene is hard to read",
                       counts=unit, subjects=round(primary_avg, 1), peak=peak,
                       disagreement=round(disagreement, 3), realtime=net["realtime_factor"])

    provisional, note, threshold = _too_quiet(playlist, claim, primary_avg, seconds, window, url)
    return Verdict(
        url, True, note, threshold=threshold, scene=scene_hash,
        counts=unit, subjects=round(primary_avg, 1), peak=peak,
        disagreement=round(disagreement, 3), realtime=net["realtime_factor"],
        provisional=provisional,
    )


def settle_near(value: float) -> int:
    """A threshold a market can honestly turn on.

    Rounded, because a bar of 227 from a twenty second sample claims a precision
    the sample does not have, and a market reads as arbitrary when its number
    looks measured to the unit.
    """
    if value < 10:
        return max(1, round(value))
    step = 5 if value < 100 else 10 if value < 500 else 25
    return int(step * round(value / step))


def _too_quiet(playlist: str, claim: dict | None, occupancy: float,
               seconds: float, window: float, source: str = "") -> tuple[bool, str, int]:
    """Whether one subject either way would swing the settled value.

    Measured against whatever the market actually settles on. For a level claim
    that is the number in view, so occupancy is the right yardstick. For a line
    claim it is the total that crossed over the whole window, which is a far
    larger number: Abbey Road holds nine people at a glance and still passes a
    couple of hundred over fifteen minutes. Judging crossings by occupancy
    benched the busiest camera we had.
    """
    line = ((claim or {}).get("options") or {}).get("line")
    if (claim or {}).get("kind") != "crossings" or not line:
        quiet = occupancy < MIN_FOR_PERCENT
        note = "quiet enough that one subject moves the result" if quiet else "usable"
        return quiet, note, settle_near(occupancy)

    from .claims import Claim
    from .crossings import Crossings

    counting = Claim(stream_id="inspection", kind="crossings",
                     target=(claim.get("target") or "anything"), options=claim["options"])

    # The occupancy pass has just held this stream for the best part of a
    # minute, and opening it again straight away is refused often enough to
    # matter. Resolve a fresh playlist and try once more before believing it.
    sample = Crossings().observe(playlist, counting, seconds, "primary_vision")
    if sample.detail.get("reason") and source:
        from .probe import resolve as resolve_again

        fresh = resolve_again(source)
        if fresh:
            sample = Crossings().observe(fresh, counting, seconds, "primary_vision")

    # A count that could not be taken is not a count of nothing. The observer
    # reports why it gave up, and reading its zero as an empty road benched two
    # busy cameras: Fresno measured 0 here and 30 crossings in 45s a few minutes
    # later, on the same line, with the scene 4 bits from where it qualified.
    #
    # Threshold 0 on purpose: the store only writes a threshold above zero, so
    # whatever was measured last time survives a failed look.
    failed = sample.detail.get("reason")
    if failed:
        return True, f"could not count this window: {failed}", 0

    expected = sample.count * (window / seconds) if seconds > 0 else 0.0
    quiet = expected < MIN_FOR_PERCENT
    note = (f"about {expected:.0f} crossings a window is too few to settle on"
            if quiet else f"about {expected:.0f} crossings a window")
    return quiet, note, settle_near(expected)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python -m scry_vision.qualify <stream url> [...]", file=sys.stderr)
        return 2

    worst = 0
    for url in sys.argv[1:]:
        v = inspect(url)
        print(json.dumps(asdict(v)), flush=True)
        worst = max(worst, 0 if v.usable else 1)
    return worst


if __name__ == "__main__":
    sys.exit(main())
