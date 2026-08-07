"""Counts what is in view, for claims that have no line.

Some things are not events. "How many people are in the square" is a level, not
a crossing, and needs no geometry from the submitter at all.
"""

from __future__ import annotations

import statistics

from .claims import Claim, Reading
from .crossings import COUNTABLE
from .detector import MODELS, _load

STRIDE = 4


class Objects:
    kind = "objects"

    def supports(self, claim: Claim) -> bool:
        return claim.target in COUNTABLE

    def qualify(self, url: str, claim: Claim, seconds: float = 45) -> tuple[bool, str]:
        reading = self.observe(url, claim, seconds, "primary_vision")
        if reading.detail.get("frames", 0) == 0:
            return False, "no frames arrived"
        if reading.count == 0:
            return False, f"no {claim.target} appeared"
        return True, f"about {reading.count} {claim.target} in view"

    def observe(self, url: str, claim: Claim, seconds: float, role: str) -> Reading:
        import time

        import cv2

        model = MODELS[role]
        yolo = _load(model.weights)
        classes = [COUNTABLE[claim.target]]

        capture = cv2.VideoCapture(url)
        if not capture.isOpened():
            return Reading(0, [], detail={"reason": "stream unreachable"})

        counts: list[int] = []
        frames = 0
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            ok, frame = capture.read()
            if not ok:
                continue
            frames += 1
            if frames % STRIDE:
                continue
            result = yolo.predict(frame, imgsz=640, conf=model.confidence,
                                  iou=model.iou, classes=classes, verbose=False)[0]
            counts.append(0 if result.boxes is None else len(result.boxes))
        capture.release()

        return Reading(
            count=round(statistics.fmean(counts)) if counts else 0,
            samples=[],
            detail={"frames": frames, "peak": max(counts, default=0), "model": model.version},
        )
