"""Counts what is visible, rather than what crosses a line.

A crossing count needs a line, and a line needs its position, orientation and
extent chosen per camera. Every one of those was wrong at least once here, and
none of it generalises to the next camera. Occupancy needs none: the same code
and the same settings work anywhere, and adding a camera is a url and a class.

Frames go to the model at their native size. Downscaling first, inherited from
the background-subtraction code where it was a reasonable trade, cost roughly
seven eighths of the detections.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from .detector import MODELS, PEOPLE, VEHICLES, _load

INFERENCE_SIZE = 640

# Frames read per frame inferred. Reading is cheap and keeps the footage
# timeline whole; inference at native resolution is not, and falling behind the
# stream leaves gaps that void the window however good the count is. Counting
# what is in view does not need every frame, unlike a crossing count which had
# to see a subject on both sides of a line.
STRIDE = 4


@dataclass
class Occupancy:
    """How many subjects are in view, sampled over a window."""

    role: str
    unit: str
    samples: list[int] = field(default_factory=list)
    seen: int = 0

    def __post_init__(self) -> None:
        self.model = MODELS[self.role]
        self._yolo = _load(self.model.weights)
        self._classes = list(PEOPLE if self.unit == "people" else VEHICLES)

    def feed(self, frame) -> None:
        self.seen += 1
        if self.seen % STRIDE:
            return
        result = self._yolo.predict(
            frame,
            imgsz=INFERENCE_SIZE,
            conf=self.model.confidence,
            iou=self.model.iou,
            classes=self._classes,
            verbose=False,
        )[0]
        self.samples.append(0 if result.boxes is None else len(result.boxes))

    @property
    def count(self) -> int:
        """The settled value: mean occupancy across the window, rounded.

        A mean rather than a peak, because one frame with a bus in it should not
        decide a market.
        """
        return round(statistics.fmean(self.samples)) if self.samples else 0

    @property
    def peak(self) -> int:
        return max(self.samples) if self.samples else 0


def occupancy_for(scene, role: str) -> Occupancy:
    return Occupancy(role=role, unit=scene.unit)
