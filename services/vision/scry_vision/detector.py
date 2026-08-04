"""Detection and tracking via YOLO and ByteTrack.

Replaces background subtraction plus nearest-neighbour matching, which lost
identity whenever subjects overlapped and counted each fragment again.

Crossings go through CountLineTracker rather than supervision's LineZone: that
still calls np.cross on 2-D vectors, which numpy 2 removed. The repo's own
tracker already has the deadband and direction filter, and it is tested.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache

from .counter import CountLineTracker
from .models import CounterConfig, TrackSample
from .models import Point as ScryPoint

PEOPLE = (0,)
VEHICLES = (1, 2, 3, 5, 7)


@dataclass(frozen=True)
class Model:
    """One detector configuration.

    The profiles differ in weights and thresholds on purpose: two identical
    detectors agree even when both are wrong, and the quorum proves nothing.
    """

    name: str
    weights: str
    confidence: float
    iou: float

    @property
    def version(self) -> str:
        return f"{self.weights.removesuffix('.pt')}-bytetrack/1.0-{self.name}"


PRIMARY = Model(name="primary", weights="yolov8s.pt", confidence=0.35, iou=0.5)
VERIFY = Model(name="verify", weights="yolov8n.pt", confidence=0.25, iou=0.7)

MODELS = {"primary_vision": PRIMARY, "verification": VERIFY, "edge": VERIFY}


@lru_cache(maxsize=4)
def _load(weights: str):
    from ultralytics import YOLO

    return YOLO(weights)


class Counter:
    """Counts tracked subjects crossing the scene's line."""

    def __init__(self, model: Model, scene, label: str) -> None:
        self.model = model
        self._yolo = _load(model.weights)
        self._classes = list(PEOPLE if scene.unit == "people" else VEHICLES)
        self._label = label
        self._crossings = CountLineTracker(
            scene.line(),
            CounterConfig(
                minimum_confidence=0.0,
                deadband_distance=3,
                accepted_categories=(label,),
            ),
        )

    def feed(self, frame) -> None:
        result = self._yolo.track(
            frame,
            conf=self.model.confidence,
            iou=self.model.iou,
            classes=self._classes,
            tracker="bytetrack.yaml",
            persist=True,
            verbose=False,
        )[0]

        boxes = result.boxes
        if boxes is None or boxes.id is None:
            return

        now = datetime.now(UTC)
        for box, track_id, score in zip(
            boxes.xywh.tolist(), boxes.id.tolist(), boxes.conf.tolist()
        ):
            x, y, _, _ = box
            self._crossings.ingest(
                TrackSample(str(int(track_id)), now, ScryPoint(x=x, y=y), score, self._label)
            )

    @property
    def count(self) -> int:
        return self._crossings.count


def counter_for(scene, role: str) -> Counter:
    label = "person" if scene.unit == "people" else "vehicle"
    return Counter(MODELS[role], scene, label)
