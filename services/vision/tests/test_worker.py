import unittest

from datetime import UTC, datetime, timedelta

from scry_vision.worker import JOIN_GRACE, StreamMismatch, at, guard, pick, slot


def market(id_, stream, status="Observing"):
    return {"id": id_, "streamId": stream, "status": status}


class PickTest(unittest.TestCase):
    """An observer watches one camera. Reporting a count for a market on another
    stream would attribute a reading to a place nobody watched."""

    def setUp(self):
        self.markets = [
            market("pune-1", "stream-pune-ev"),
            market("sd-1", "stream-sd-5-28th"),
            market("sd-old", "stream-sd-5-28th", status="Resolved"),
        ]

    def test_picks_only_its_own_stream(self):
        self.assertEqual(pick(self.markets, "stream-sd-5-28th", None)["id"], "sd-1")

    def test_ignores_other_streams_entirely(self):
        self.assertIsNone(pick(self.markets, "stream-nowhere", None))

    def test_ignores_markets_that_are_not_observing(self):
        only_resolved = [market("sd-old", "stream-sd-5-28th", status="Resolved")]
        self.assertIsNone(pick(only_resolved, "stream-sd-5-28th", None))

    def test_named_market_must_also_match_the_stream(self):
        self.assertIsNone(pick(self.markets, "stream-sd-5-28th", "pune-1"))
        self.assertEqual(pick(self.markets, "stream-sd-5-28th", "sd-1")["id"], "sd-1")


class GuardTest(unittest.TestCase):
    def test_refuses_a_market_on_another_stream(self):
        with self.assertRaises(StreamMismatch):
            guard(market("pune-1", "stream-pune-ev"), "stream-sd-5-28th")

    def test_allows_a_market_on_its_own_stream(self):
        guard(market("sd-1", "stream-sd-5-28th"), "stream-sd-5-28th")


if __name__ == "__main__":
    unittest.main()


class SlotTest(unittest.TestCase):
    """Two counts are only comparable if they cover the same seconds. The slot
    comes from the market so every observer computes the same one."""

    def market(self, starts, ends):
        return {"id": "m", "streamId": "s", "status": "Observing",
                "observationStartsAt": starts, "observationEndsAt": ends}

    def test_both_observers_derive_the_same_slot(self):
        m = self.market("2026-07-30T06:27:03Z", "2026-07-30T06:42:03Z")
        # Same market, same cap, two processes: the pair must be identical.
        self.assertEqual(slot(m, 150), slot(m, 150))

    def test_slot_starts_when_observation_opens_not_when_the_worker_wakes(self):
        m = self.market("2026-07-30T06:27:03Z", "2026-07-30T06:42:03Z")
        opens, _ = slot(m, 150)
        self.assertEqual(opens.isoformat(), "2026-07-30T06:27:03+00:00")

    def test_cap_bounds_a_long_window(self):
        m = self.market("2026-07-30T06:27:03Z", "2026-07-30T06:42:03Z")
        opens, closes = slot(m, 150)
        self.assertEqual((closes - opens).total_seconds(), 150)

    def test_a_window_shorter_than_the_cap_is_not_extended_past_its_end(self):
        m = self.market("2026-07-30T06:27:03Z", "2026-07-30T06:28:03Z")
        _, closes = slot(m, 150)
        self.assertEqual(closes.isoformat(), "2026-07-30T06:28:03+00:00")


class CoverageTest(unittest.TestCase):
    """A market asks how many crossed during its window. Anything less than the
    whole window is a wrong answer, not a partial one."""

    def slot_for(self, minutes):
        starts = datetime(2026, 7, 30, 6, 27, 3, tzinfo=UTC)
        return {"id": "m", "streamId": "s", "status": "Observing",
                "observationStartsAt": starts.isoformat().replace("+00:00", "Z"),
                "observationEndsAt": (starts + timedelta(minutes=minutes))
                                     .isoformat().replace("+00:00", "Z")}

    def test_grace_is_small_next_to_the_window_it_guards(self):
        m = self.slot_for(15)
        opens, closes = slot(m, 900)
        self.assertLess(JOIN_GRACE / (closes - opens).total_seconds(), 0.05)

    def test_slot_never_runs_past_the_declared_window(self):
        m = self.slot_for(15)
        _, closes = slot(m, 3600)
        self.assertEqual(closes, at(m, "observationEndsAt"))
