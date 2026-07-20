from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from math import hypot


class CrossingDirection(StrEnum):
    POSITIVE_TO_NEGATIVE = "positive_to_negative"
    NEGATIVE_TO_POSITIVE = "negative_to_positive"


@dataclass(frozen=True, slots=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class CountLine:
    start: Point
    end: Point
    accepted_direction: CrossingDirection | None = None

    def __post_init__(self) -> None:
        if self.start == self.end:
            raise ValueError("Count line endpoints must be different.")

    def signed_distance(self, point: Point) -> float:
        width = self.end.x - self.start.x
        height = self.end.y - self.start.y
        return (width * (point.y - self.start.y) - height * (point.x - self.start.x)) / hypot(width, height)


@dataclass(frozen=True, slots=True)
class CounterConfig:
    minimum_confidence: float = 0.8
    accepted_categories: tuple[str, ...] = ("vehicle",)
    deadband_distance: float = 2
    stale_track_seconds: float = 5

    def __post_init__(self) -> None:
        if not 0 <= self.minimum_confidence <= 1:
            raise ValueError("Minimum confidence must be between zero and one.")
        if not self.accepted_categories or len(set(self.accepted_categories)) != len(self.accepted_categories):
            raise ValueError("Accepted categories must be non-empty and unique.")
        if self.deadband_distance < 0 or self.stale_track_seconds <= 0:
            raise ValueError("Tracking distances and timeouts must be valid.")


@dataclass(frozen=True, slots=True)
class TrackSample:
    track_id: str
    timestamp: datetime
    centroid: Point
    confidence: float
    category: str

    def __post_init__(self) -> None:
        if not self.track_id or not self.category:
            raise ValueError("Track identity and category are required.")
        if self.timestamp.tzinfo is None:
            raise ValueError("Track timestamp must include a timezone.")
        if not 0 <= self.confidence <= 1:
            raise ValueError("Track confidence must be between zero and one.")


@dataclass(frozen=True, slots=True)
class CrossingEvent:
    track_id: str
    timestamp: datetime
    direction: CrossingDirection
    category: str
    confidence: float
