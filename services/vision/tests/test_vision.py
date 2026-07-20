import json
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from scry_vision import CountLine, CountLineTracker, CounterConfig, CrossingDirection, Point, TrackSample, execute_counting


def sample(track_id: str, second: float, x: float, confidence: float = 0.95, category: str = "vehicle") -> TrackSample:
    return TrackSample(track_id, datetime(2026, 7, 21, 11, tzinfo=UTC) + timedelta(seconds=second), Point(x, 0), confidence, category)


def tracker(direction: CrossingDirection | None = None, stale_seconds: float = 5) -> CountLineTracker:
    return CountLineTracker(
        CountLine(Point(0, -10), Point(0, 10), direction),
        CounterConfig(deadband_distance=1, stale_track_seconds=stale_seconds),
    )


class CountLineTests(unittest.TestCase):
    def test_track_crosses_once_despite_later_oscillation(self) -> None:
        counter = tracker()
        counter.ingest(sample("a", 0, -5))
        event = counter.ingest(sample("a", 1, 5))
        counter.ingest(sample("a", 2, -5))
        self.assertEqual(event.direction, CrossingDirection.POSITIVE_TO_NEGATIVE)
        self.assertEqual(counter.count, 1)

    def test_deadband_jitter_does_not_replace_the_last_significant_side(self) -> None:
        counter = tracker()
        counter.ingest(sample("a", 0, -5))
        counter.ingest(sample("a", 1, 0.4))
        self.assertIsNotNone(counter.ingest(sample("a", 2, 5)))

    def test_direction_filter_rejects_the_reverse_crossing(self) -> None:
        counter = tracker(CrossingDirection.POSITIVE_TO_NEGATIVE)
        counter.ingest(sample("a", 0, 5))
        self.assertIsNone(counter.ingest(sample("a", 1, -5)))
        self.assertEqual(counter.count, 0)

    def test_low_confidence_and_unaccepted_categories_are_ignored(self) -> None:
        counter = tracker()
        counter.ingest(sample("a", 0, -5, confidence=0.5))
        counter.ingest(sample("a", 1, 5))
        counter.ingest(sample("b", 0, -5, category="person"))
        counter.ingest(sample("b", 1, 5, category="person"))
        self.assertEqual(counter.count, 0)

    def test_stale_track_identity_can_be_reused_after_timeout(self) -> None:
        counter = tracker(stale_seconds=2)
        counter.ingest(sample("a", 0, -5))
        counter.ingest(sample("a", 1, 5))
        counter.ingest(sample("a", 4, -5))
        counter.ingest(sample("a", 5, 5))
        self.assertEqual(counter.count, 2)

    def test_out_of_order_track_samples_are_rejected(self) -> None:
        counter = tracker()
        counter.ingest(sample("a", 2, -5))
        with self.assertRaises(ValueError):
            counter.ingest(sample("a", 1, 5))

    def test_fixture_counts_only_the_accepted_crossing(self) -> None:
        path = Path(__file__).parents[1] / "fixtures" / "count_line.json"
        output = execute_counting(json.loads(path.read_text(encoding="utf-8")))
        self.assertEqual(output["count"], 1)
        self.assertEqual(output["events"][0]["track_id"], "vehicle-1")


if __name__ == "__main__":
    unittest.main()
