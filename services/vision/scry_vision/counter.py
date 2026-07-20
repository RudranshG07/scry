from dataclasses import dataclass

from .models import CountLine, CounterConfig, CrossingDirection, CrossingEvent, TrackSample


@dataclass(slots=True)
class _TrackState:
    sample: TrackSample
    side: float
    counted: bool = False


class CountLineTracker:
    def __init__(self, line: CountLine, config: CounterConfig = CounterConfig()) -> None:
        self.line = line
        self.config = config
        self._tracks: dict[str, _TrackState] = {}
        self._events: list[CrossingEvent] = []

    @property
    def count(self) -> int:
        return len(self._events)

    @property
    def events(self) -> tuple[CrossingEvent, ...]:
        return tuple(self._events)

    def ingest(self, sample: TrackSample) -> CrossingEvent | None:
        if sample.category not in self.config.accepted_categories or sample.confidence < self.config.minimum_confidence:
            return None
        side = self.line.signed_distance(sample.centroid)
        state = self._tracks.get(sample.track_id)
        if state:
            elapsed = (sample.timestamp - state.sample.timestamp).total_seconds()
            if elapsed < 0:
                raise ValueError("Track samples must be ingested in timestamp order.")
            if elapsed > self.config.stale_track_seconds:
                state = None
                self._tracks.pop(sample.track_id)
        if abs(side) <= self.config.deadband_distance:
            return None
        if state is None:
            self._tracks[sample.track_id] = _TrackState(sample, side)
            return None
        if state.counted:
            state.sample = sample
            state.side = side
            return None
        direction: CrossingDirection | None = None
        if state.side > 0 and side < 0:
            direction = CrossingDirection.POSITIVE_TO_NEGATIVE
        elif state.side < 0 and side > 0:
            direction = CrossingDirection.NEGATIVE_TO_POSITIVE
        state.sample = sample
        state.side = side
        if direction is None or self.line.accepted_direction not in (None, direction):
            return None
        state.counted = True
        event = CrossingEvent(sample.track_id, sample.timestamp, direction, sample.category, sample.confidence)
        self._events.append(event)
        return event
