"""Stream quality metrics, testable without a camera or a codec."""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import fmean

# Measured: degenerate frames stay under 10 std-dev, working cameras run 45-69.
GOOD_CONTRAST = 60.0
MIN_CONTRAST = 20.0

MIN_VISIBILITY = MIN_CONTRAST / GOOD_CONTRAST

# Blind time may not move the count by more than the settlement tolerance, which
# is 5%. At 0.99 this floor was stricter than the bar it protects: a fifteen
# minute window allowed nine seconds of gap, two observers on a healthy CDN
# stream independently measured about twenty, and every market they counted was
# thrown away for footage quality better than the result needed.
MIN_UPTIME = 0.95


# A jump this large in the footage means something could cross unseen.
BLIND_AFTER = 1.0


@dataclass
class Health:
    frames: int = 0
    dropped: int = 0
    frozen_run: int = 0
    longest_frozen: int = 0
    contrast: list[float] = field(default_factory=list)
    blind_seconds: float = 0.0
    longest_gap: float = 0.0

    def saw_frame(self, since_last: float) -> None:
        """since_last is the step in the footage's own timeline, not in arrival
        time. HLS hands over a whole segment at once, so frames arrive in bursts
        with seconds of silence between them while missing nothing."""
        self.longest_gap = max(self.longest_gap, since_last)
        if since_last > BLIND_AFTER:
            self.blind_seconds += since_last - BLIND_AFTER

    def uptime(self, window: float) -> float:
        """Share of the window the footage actually covers."""
        if window <= 0 or self.frames == 0:
            return 0.0
        return max(0.0, min(1.0, (window - self.blind_seconds) / window))

    def visibility(self) -> float:
        if not self.contrast:
            return 0.0
        return min(1.0, fmean(self.contrast) / GOOD_CONTRAST)


def faults(ok: bool, uptime: float, visibility: float) -> list[str]:
    """Reasons this report must not count towards a result."""
    bad = []
    if not ok:
        bad.append("evidence_unavailable")
    if uptime < MIN_UPTIME:
        bad.append("uptime_below_minimum")
    if visibility < MIN_VISIBILITY:
        bad.append("visibility_below_minimum")
    return bad
