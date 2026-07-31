import unittest

from datetime import UTC, datetime, timedelta

from scry_vision.calibrate import spread, summarise
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


class SpreadTest(unittest.TestCase):
    def test_spread_is_measured_against_the_lower_count(self):
        self.assertAlmostEqual(spread(100, 110), 10.0)
        self.assertAlmostEqual(spread(110, 100), 10.0)

    def test_identical_counts_do_not_disagree(self):
        self.assertEqual(spread(42, 42), 0.0)

    def test_zero_counts_do_not_divide(self):
        self.assertEqual(spread(0, 0), 0.0)


class SummariseTest(unittest.TestCase):
    def summary(self, gaps):
        return summarise([{"ok": True, "spread": g} for g in gaps])

    def test_reports_the_shape_not_just_the_mean(self):
        s = self.summary([5.3, 11.6, 4.0, 14.5])
        self.assertEqual(s["windows"], 4)
        self.assertEqual(s["best"], 4.0)
        self.assertEqual(s["worst"], 14.5)
        self.assertIsNotNone(s["stdev"])

    def test_a_single_window_reports_no_stdev_rather_than_zero(self):
        # One window looks perfectly consistent, which is exactly the false
        # confidence this tool exists to prevent.
        self.assertIsNone(self.summary([7.0])["stdev"])

    def test_failed_windows_are_counted_not_averaged_in(self):
        s = summarise([{"ok": True, "spread": 4.0}, {"ok": False, "reason": "no frames"}])
        self.assertEqual(s["windows"], 1)
        self.assertEqual(s["failed"], 1)

    def test_no_usable_windows_is_reported_as_none(self):
        self.assertEqual(summarise([{"ok": False, "reason": "x"}])["windows"], 0)


class RelayTest(unittest.TestCase):
    """Observers on one stream must read the same frames. Deriving the url from
    the stream id means two of them cannot end up on different sources."""

    def url(self, relay, stream):
        return f"{relay.rstrip('/')}/{stream}/index.m3u8"

    def test_both_observers_derive_the_same_relay_url(self):
        a = self.url("http://127.0.0.1:8888", "stream-sd-8-15")
        b = self.url("http://127.0.0.1:8888/", "stream-sd-8-15")
        self.assertEqual(a, b)
        self.assertEqual(a, "http://127.0.0.1:8888/stream-sd-8-15/index.m3u8")

    def test_each_stream_gets_its_own_path(self):
        relay = "http://127.0.0.1:8888"
        self.assertNotEqual(self.url(relay, "stream-sd-8-15"), self.url(relay, "stream-sd-5-28th"))


if __name__ == "__main__":
    unittest.main()
