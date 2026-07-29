import unittest

from scry_vision.worker import StreamMismatch, guard, pick


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
