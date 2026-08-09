import unittest
from unittest import mock

from scry_vision.claims import Reading
from scry_vision.qualify import MIN_FOR_PERCENT, _too_quiet, settle_near


class QuietRuleTest(unittest.TestCase):
    """A stream is judged against the number its markets settle on.

    Occupancy is the settled value for a level claim and nothing like it for a
    line claim, where a handful of subjects in view still add up to hundreds of
    crossings over a window.
    """

    def test_a_level_claim_is_judged_on_how_many_are_in_view(self):
        quiet, _, _ = _too_quiet("playlist", {"kind": "objects"}, 9.0, 45, 900)
        self.assertTrue(quiet)
        quiet, _, _ = _too_quiet("playlist", {"kind": "objects"}, 40.0, 45, 900)
        self.assertFalse(quiet)

    def test_a_claim_with_no_line_falls_back_to_occupancy(self):
        quiet, _, _ = _too_quiet("playlist", {"kind": "crossings", "options": {}}, 9.0, 45, 900)
        self.assertTrue(quiet)

    def test_a_line_claim_is_judged_on_crossings_over_the_window(self):
        claim = {"kind": "crossings", "target": "person",
                 "options": {"line": [[0.05, 0.42], [0.95, 0.42]]}}
        # Abbey Road's measured rate: eight crossings in forty seconds is about
        # 180 a window, where one either way is well inside the settlement bar.
        with mock.patch("scry_vision.crossings.Crossings.observe",
                        return_value=Reading(count=8, samples=[])):
            quiet, note, _ = _too_quiet("playlist", claim, 9.0, 40, 900)
        self.assertFalse(quiet, note)
        self.assertIn("180", note)

    def test_a_line_over_a_dead_stretch_is_still_refused(self):
        claim = {"kind": "crossings", "options": {"line": [[0.0, 0.5], [1.0, 0.5]]}}
        with mock.patch("scry_vision.crossings.Crossings.observe",
                        return_value=Reading(count=0, samples=[])):
            quiet, _, _ = _too_quiet("playlist", claim, 30.0, 40, 900)
        self.assertTrue(quiet)


class ThresholdTest(unittest.TestCase):
    """A market has to be able to land either way.

    The scheduler falls back to a flat 180 for every camera, so a road that
    passes a hundred a window settles "no" every time and the market is decided
    before anyone can take a position.
    """

    def test_a_threshold_is_measured_from_what_the_camera_passes(self):
        claim = {"kind": "crossings", "target": "person",
                 "options": {"line": [[0.05, 0.42], [0.95, 0.42]]}}
        with mock.patch("scry_vision.crossings.Crossings.observe",
                        return_value=Reading(count=8, samples=[])):
            _, _, threshold = _too_quiet("playlist", claim, 9.8, 40, 900)
        # Eight in forty seconds is 180 a window.
        self.assertEqual(threshold, 180)

    def test_a_level_claim_is_set_at_the_level(self):
        _, _, threshold = _too_quiet("playlist", {"kind": "objects"}, 31.4, 45, 900)
        self.assertEqual(threshold, 30)

    def test_thresholds_are_round_numbers(self):
        for value, want in [(0.4, 1), (3.2, 3), (9.7, 10), (37.0, 35), (103.0, 100),
                            (227.0, 230), (1013.0, 1025)]:
            self.assertEqual(settle_near(value), want, f"settle_near({value})")

    def test_a_stream_nothing_could_be_measured_on_asks_for_no_threshold(self):
        with mock.patch("scry_vision.crossings.Crossings.observe",
                        return_value=Reading(count=0, samples=[])):
            _, _, threshold = _too_quiet(
                "playlist", {"kind": "crossings", "options": {"line": [[0, 0.5], [1, 0.5]]}},
                30.0, 40, 900)
        # Zero, so the store leaves whatever threshold was already there rather
        # than setting the market to "more than nothing".
        self.assertEqual(threshold, 1)
