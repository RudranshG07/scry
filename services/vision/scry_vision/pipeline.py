from dataclasses import asdict
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from .counter import CountLineTracker
from .models import CountLine, CounterConfig, CrossingDirection, Point, TrackSample


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _serializable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _serializable(item) for key, item in value.items()}
    return value


def execute_counting(document: dict[str, Any]) -> dict[str, Any]:
    line_document = document["line"]
    direction = line_document.get("acceptedDirection")
    line = CountLine(
        Point(line_document["start"]["x"], line_document["start"]["y"]),
        Point(line_document["end"]["x"], line_document["end"]["y"]),
        CrossingDirection(direction) if direction else None,
    )
    config_document = document.get("config", {})
    tracker = CountLineTracker(
        line,
        CounterConfig(
            minimum_confidence=config_document.get("minimumConfidence", 0.8),
            accepted_categories=tuple(config_document.get("acceptedCategories", ["vehicle"])),
            deadband_distance=config_document.get("deadbandDistance", 2),
            stale_track_seconds=config_document.get("staleTrackSeconds", 5),
        ),
    )
    for sample in document["samples"]:
        tracker.ingest(TrackSample(
            track_id=sample["trackId"],
            timestamp=_timestamp(sample["timestamp"]),
            centroid=Point(sample["centroid"]["x"], sample["centroid"]["y"]),
            confidence=sample["confidence"],
            category=sample["category"],
        ))
    return {
        "count": tracker.count,
        "events": [_serializable(asdict(event)) for event in tracker.events],
    }
