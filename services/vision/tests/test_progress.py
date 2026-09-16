import json
import os
import unittest
from contextlib import contextmanager
from unittest import mock

from scry_vision.observer import Progress

KEY = "0x" + "00" * 31 + "01"


@contextmanager
def threads_inline():
    """Run what the reporter hands to a thread on the spot, so a test can see it."""
    def immediate(target, args=(), daemon=None):
        handle = mock.MagicMock()
        handle.start.side_effect = lambda: target(*args)
        return handle

    with mock.patch("scry_vision.observer.threading.Thread", side_effect=immediate):
        yield


class ProgressTest(unittest.TestCase):
    def reporter(self, **changes):
        return Progress("http://api/", "market-1", "vision-01", "primary_vision", **changes)

    def test_it_sends_at_most_one_count_an_interval(self):
        progress = self.reporter(every=60)
        with threads_inline(), mock.patch.object(Progress, "send") as send:
            progress(5, 1.0)
            progress(6, 2.0)
        self.assertEqual(send.call_count, 1)

    def test_the_next_interval_sends_the_newer_count(self):
        progress = self.reporter(every=0)
        with threads_inline(), mock.patch.object(Progress, "send") as send:
            progress(5, 1.0)
            progress(6, 2.0)
        self.assertEqual([call.args[0] for call in send.call_args_list], [5, 6])

    def test_a_count_is_dropped_while_the_last_is_still_in_flight(self):
        progress = self.reporter(every=0)
        progress.sending.acquire()
        try:
            with threads_inline(), mock.patch.object(Progress, "send") as send:
                progress(5, 1.0)
            self.assertEqual(send.call_count, 0)
        finally:
            progress.sending.release()

    def test_the_running_count_is_signed_like_a_report(self):
        sent = {}

        def capture(request, timeout=None):
            sent["url"] = request.full_url
            sent["body"] = json.loads(request.data)
            sent["signature"] = request.headers.get("X-scry-signature")
            return mock.MagicMock()

        with mock.patch.dict(os.environ, {"SCRY_OBSERVER_KEY": KEY}), \
             mock.patch("urllib.request.urlopen", side_effect=capture):
            self.reporter().send(87, 123.4)

        self.assertEqual(sent["url"], "http://api/v1/markets/market-1/progress")
        self.assertEqual(sent["body"]["observerId"], "vision-01")
        self.assertEqual(sent["body"]["count"], 87)
        self.assertEqual(sent["body"]["elapsedSeconds"], 123.4)
        self.assertTrue(sent["signature"].startswith("0x"))
        self.assertEqual(len(sent["signature"]), 132)

    def test_an_api_that_is_down_never_reaches_the_counting_loop(self):
        with mock.patch.dict(os.environ, {"SCRY_OBSERVER_KEY": KEY}), \
             mock.patch("urllib.request.urlopen", side_effect=OSError("no api")):
            self.reporter().send(5, 1.0)
