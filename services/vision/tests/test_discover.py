import unittest
from unittest import mock

from scry_vision.claims import Reading
from scry_vision.discover import CANDIDATES, MIN_CROSSINGS, assess, live_candidates, propose_line


class CandidateTest(unittest.TestCase):
    def test_every_candidate_line_is_two_points_inside_the_frame(self):
        for note, line in CANDIDATES.items():
            self.assertEqual(len(line), 2, note)
            for x, y in line:
                self.assertGreaterEqual(x, 0.0, note)
                self.assertLessEqual(x, 1.0, note)
                self.assertGreaterEqual(y, 0.0, note)
                self.assertLessEqual(y, 1.0, note)

    def test_candidates_cover_both_orientations(self):
        horizontal = [l for l in CANDIDATES.values() if l[0][1] == l[1][1]]
        vertical = [l for l in CANDIDATES.values() if l[0][0] == l[1][0]]
        # Abbey Road counts eight across a horizontal line and none across a
        # vertical one at x=0.35. Offering only one orientation would have
        # rejected the busiest camera in the pool.
        self.assertTrue(horizontal)
        self.assertTrue(vertical)


class ProposeLineTest(unittest.TestCase):
    def test_the_line_that_counts_most_wins(self):
        counts = iter([1, 9, 0, 3])
        with mock.patch("scry_vision.crossings.Crossings.observe",
                        side_effect=lambda *a, **k: Reading(count=next(counts), samples=[])):
            line, count, note = propose_line("playlist", "anything", seconds=1)
        self.assertEqual(count, 9)
        self.assertEqual(line, list(CANDIDATES.values())[1])
        self.assertIn(note, CANDIDATES)

    def test_a_scene_where_nothing_crosses_proposes_nothing(self):
        with mock.patch("scry_vision.crossings.Crossings.observe",
                        return_value=Reading(count=0, samples=[])):
            line, count, _ = propose_line("playlist", "anything", seconds=1)
        self.assertIsNone(line)
        self.assertEqual(count, 0)


class AssessTest(unittest.TestCase):
    def _verdict(self, usable=True, counts="vehicles", reason="usable", provisional=False):
        return mock.Mock(usable=usable, counts=counts, reason=reason, provisional=provisional)

    def test_a_link_with_no_live_stream_is_refused_before_anything_is_watched(self):
        with mock.patch("scry_vision.probe.resolve", return_value=None) as resolve:
            out = assess("https://example.com/gone", seconds=1)
        self.assertFalse(out["usable"])
        resolve.assert_called_once()

    def test_an_unreadable_scene_is_refused_without_trying_lines(self):
        with mock.patch("scry_vision.probe.resolve", return_value="playlist"), \
             mock.patch("scry_vision.qualify.inspect",
                        return_value=self._verdict(usable=False, reason="two models disagree by 28%")), \
             mock.patch("scry_vision.discover.propose_line") as lines:
            out = assess("https://example.com/live", seconds=1)
        self.assertFalse(out["usable"])
        # Four counting passes on a scene already known to be unreadable is
        # about two minutes of nothing per camera.
        lines.assert_not_called()

    def test_a_busy_scene_comes_back_with_a_line_to_count_across(self):
        with mock.patch("scry_vision.probe.resolve", return_value="playlist"), \
             mock.patch("scry_vision.qualify.inspect", return_value=self._verdict()), \
             mock.patch("scry_vision.discover.propose_line",
                        return_value=([[0.05, 0.5], [0.95, 0.5]], 7, "across the middle")):
            out = assess("https://example.com/live", seconds=1)
        self.assertTrue(out["usable"])
        self.assertEqual(out["claim"]["kind"], "crossings")
        self.assertEqual(len(out["claim"]["options"]["line"]), 2)
        self.assertEqual(out["category"], "Traffic")

    def test_people_and_vehicles_become_different_claims(self):
        with mock.patch("scry_vision.probe.resolve", return_value="playlist"), \
             mock.patch("scry_vision.qualify.inspect", return_value=self._verdict(counts="people")), \
             mock.patch("scry_vision.discover.propose_line",
                        return_value=([[0.05, 0.42], [0.95, 0.42]], 8, "across the far side")):
            out = assess("https://example.com/live", seconds=1)
        self.assertEqual(out["claim"]["target"], "person")
        self.assertEqual(out["category"], "Footfall")

    def test_a_scene_where_nothing_crosses_is_not_offered_a_market(self):
        with mock.patch("scry_vision.probe.resolve", return_value="playlist"), \
             mock.patch("scry_vision.qualify.inspect", return_value=self._verdict()), \
             mock.patch("scry_vision.discover.propose_line",
                        return_value=(None, MIN_CROSSINGS - 1, "nothing crossed")):
            out = assess("https://example.com/live", seconds=1)
        self.assertFalse(out["usable"])


class SearchTest(unittest.TestCase):
    def test_only_streams_that_are_live_now_are_returned(self):
        payload = (
            '{"entries": ['
            '{"id":"a","title":"live one","live_status":"is_live"},'
            '{"id":"b","title":"ended","live_status":"was_live"},'
            '{"id":"c","title":"upcoming","live_status":"is_upcoming"}'
            ']}')
        with mock.patch("scry_vision.probe._ytdlp", return_value=payload):
            found = live_candidates("anything", 5)
        self.assertEqual([f["id"] for f in found], ["a"])

    def test_a_search_that_returns_nothing_usable_is_not_an_error(self):
        with mock.patch("scry_vision.probe._ytdlp", return_value=None):
            self.assertEqual(live_candidates("anything", 5), [])
        with mock.patch("scry_vision.probe._ytdlp", return_value="not json"):
            self.assertEqual(live_candidates("anything", 5), [])


class QuietHoursTest(unittest.TestCase):
    def test_a_camera_that_is_merely_empty_now_is_not_tried_for_lines(self):
        with mock.patch("scry_vision.probe.resolve", return_value="playlist"), \
             mock.patch("scry_vision.qualify.inspect",
                        return_value=mock.Mock(usable=True, provisional=True,
                                               counts="people", reason="nothing much in view right now")), \
             mock.patch("scry_vision.discover.propose_line") as lines:
            out = assess("https://example.com/live", seconds=1)
        self.assertFalse(out["usable"])
        lines.assert_not_called()
