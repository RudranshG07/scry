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

import json
import statistics
import sys
from dataclasses import asdict, dataclass

MIN_REALTIME = 3.0
MIN_SUBJECTS = 3.0
# One subject either way has to move the count by less than the resolver's 5%
# bar, so 25 rather than 20: at exactly 20 a single subject is 5.0%, right on
# the line. Abbey Road at six people put one pedestrian at 17%.
MIN_FOR_PERCENT = 25.0
MAX_DISAGREEMENT = 0.20


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

    net = throughput(playlist)
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

    capture = cv2.VideoCapture(playlist)
    if not capture.isOpened():
        return Verdict(url, False, "the stream would not open")

    started = time.monotonic()
    while time.monotonic() - started < seconds:
        ok, frame = capture.read()
        if not ok:
            continue
        for primary, verify in watchers.values():
            primary.feed(frame)
            verify.feed(frame)
    capture.release()

    scored = {
        unit: (_average(primary.samples), _average(verify.samples), primary.peak)
        for unit, (primary, verify) in watchers.items()
    }
    unit, (primary_avg, verify_avg, peak) = max(scored.items(), key=lambda kv: kv[1][0])

    if primary_avg < MIN_SUBJECTS:
        return Verdict(url, False,
                       "too little happens in view to count; subjects may be too small or too few",
                       counts=unit, subjects=round(primary_avg, 1), peak=peak,
                       realtime=net["realtime_factor"])

    lo, hi = sorted((primary_avg, verify_avg))
    disagreement = (hi - lo) / lo if lo else 1.0
    if disagreement > MAX_DISAGREEMENT:
        return Verdict(url, False,
                       f"two models disagree by {disagreement:.0%}; the scene is hard to read",
                       counts=unit, subjects=round(primary_avg, 1), peak=peak,
                       disagreement=round(disagreement, 3), realtime=net["realtime_factor"])

    provisional, note = _too_quiet(playlist, claim, primary_avg, seconds, window)
    return Verdict(
        url, True, note,
        counts=unit, subjects=round(primary_avg, 1), peak=peak,
        disagreement=round(disagreement, 3), realtime=net["realtime_factor"],
        provisional=provisional,
    )


def _too_quiet(playlist: str, claim: dict | None, occupancy: float,
               seconds: float, window: float) -> tuple[bool, str]:
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
        return quiet, "quiet enough that one subject moves the result" if quiet else "usable"

    from .claims import Claim
    from .crossings import Crossings

    sample = Crossings().observe(
        playlist,
        Claim(stream_id="inspection", kind="crossings",
              target=(claim.get("target") or "anything"), options=claim["options"]),
        seconds, "primary_vision")

    expected = sample.count * (window / seconds) if seconds > 0 else 0.0
    quiet = expected < MIN_FOR_PERCENT
    return quiet, (
        f"about {expected:.0f} crossings a window is too few to settle on"
        if quiet else f"about {expected:.0f} crossings a window")


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
