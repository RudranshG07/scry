"""Stream quality metrics, kept apart from the detector.

Whether footage was good enough to count is a question about the stream, not
about OpenCV, and it decides whether a report is allowed to settle a market. It
lives here so it can be tested without a camera or a codec.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import fmean

# Contrast is what separates a usable frame from a useless one: fog, glare, a
# black frame and a dead sensor all flatten it, and little else does. Measured
# across the live cameras and against synthetic failures, the two groups sit far
# apart -- degenerate frames stay under 10 std-dev, working cameras run 45 to 69.
# GOOD_CONTRAST normalises the score against a well-lit scene; MIN_CONTRAST is
# the floor, placed in the empty gap between the groups rather than just below
# the best camera. A flat scene is not a broken one.
GOOD_CONTRAST = 60.0
MIN_CONTRAST = 20.0

MIN_VISIBILITY = MIN_CONTRAST / GOOD_CONTRAST
MIN_UPTIME = 0.99


@dataclass
class Health:
    frames: int = 0
    dropped: int = 0
    frozen_run: int = 0
    longest_frozen: int = 0
    contrast: list[float] = field(default_factory=list)

    def uptime(self, fps: float) -> float:
        total = self.frames + self.dropped
        return self.frames / total if total else 0.0

    def visibility(self) -> float:
        if not self.contrast:
            return 0.0
        return min(1.0, fmean(self.contrast) / GOOD_CONTRAST)


def faults(ok: bool, uptime: float, visibility: float) -> list[str]:
    """Reasons this report must not count towards a result. An empty list means
    the footage was good enough to settle on."""
    bad = []
    if not ok:
        bad.append("evidence_unavailable")
    if uptime < MIN_UPTIME:
        bad.append("uptime_below_minimum")
    if visibility < MIN_VISIBILITY:
        bad.append("visibility_below_minimum")
    return bad
