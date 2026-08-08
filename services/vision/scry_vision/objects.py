"""Counts what is in view, for claims that have no line.

Some things are not events. "How many people are in the square" is a level, not
a crossing, and needs no geometry from the submitter at all.
"""

from __future__ import annotations

import statistics

from .claims import Claim, Reading
from .crossings import COUNTABLE
from .detector import MODELS, _load
from .evidence import bundle, chain, digest, stamp
from .health import Health

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
        from datetime import UTC, datetime

        import cv2

        model = MODELS[role]
        yolo = _load(model.weights)
        classes = [COUNTABLE[claim.target]]

        capture = cv2.VideoCapture(url)
        if not capture.isOpened():
            return Reading(0, [], detail={"reason": "stream unreachable"})

        counts: list[int] = []
        frames = 0
        started = datetime.now(UTC)
        health = Health()
        last_position: float | None = None
        chained = digest(f"{url}|{started.isoformat()}".encode())
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            ok, frame = capture.read()
            if not ok:
                health.dropped += 1
                continue
            frames += 1

            # Gaps in the footage rather than in arrival, for the same reason the
            # line counter measures them that way: HLS delivers a segment at a
            # time, so frames burst with silence between while missing nothing.
            position = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if position > 0 and last_position is not None:
                health.saw_frame(max(0.0, position - last_position))
            if position > 0:
                last_position = position
            health.frames += 1

            if frames % STRIDE:
                continue
            chained = chain(chained, frame.tobytes())
            result = yolo.predict(frame, imgsz=640, conf=model.confidence,
                                  iou=model.iou, classes=classes, verbose=False)[0]
            counts.append(0 if result.boxes is None else len(result.boxes))
        capture.release()

        elapsed = (datetime.now(UTC) - started).total_seconds()
        level = round(statistics.fmean(counts)) if counts else 0
        samples = [{
            "observedAt": stamp(started),
            "count": level,
            "intervalSeconds": int(elapsed),
            "streamQuality": round(health.visibility() or 1.0, 4),
            "modelVersion": model.version,
            "frameDigest": chained,
        }] if counts else []

        return Reading(
            count=level,
            samples=samples,
            uptime=round(health.uptime(elapsed), 4),
            evidence_root=bundle(samples)[0] if samples else "",
            detail={"frames": frames, "peak": max(counts, default=0), "model": model.version},
        )
