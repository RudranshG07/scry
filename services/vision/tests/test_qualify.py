import unittest
from unittest import mock

from scry_vision.claims import Reading
from scry_vision.qualify import MIN_FOR_PERCENT, _too_quiet


class QuietRuleTest(unittest.TestCase):
    """A stream is judged against the number its markets settle on.

    Occupancy is the settled value for a level claim and nothing like it for a
    line claim, where a handful of subjects in view still add up to hundreds of
    crossings over a window.
    """

    def test_a_level_claim_is_judged_on_how_many_are_in_view(self):
        quiet, _ = _too_quiet("playlist", {"kind": "objects"}, 9.0, 45, 900)
        self.assertTrue(quiet)
        quiet, _ = _too_quiet("playlist", {"kind": "objects"}, 40.0, 45, 900)
        self.assertFalse(quiet)

    def test_a_claim_with_no_line_falls_back_to_occupancy(self):
        quiet, _ = _too_quiet("playlist", {"kind": "crossings", "options": {}}, 9.0, 45, 900)
        self.assertTrue(quiet)

    def test_a_line_claim_is_judged_on_crossings_over_the_window(self):
        claim = {"kind": "crossings", "target": "person",
                 "options": {"line": [[0.05, 0.42], [0.95, 0.42]]}}
        # Abbey Road's measured rate: eight crossings in forty seconds is about
        # 180 a window, where one either way is well inside the settlement bar.
        with mock.patch("scry_vision.crossings.Crossings.observe",
                        return_value=Reading(count=8, samples=[])):
            quiet, note = _too_quiet("playlist", claim, 9.0, 40, 900)
        self.assertFalse(quiet, note)
        self.assertIn("180", note)

    def test_a_line_over_a_dead_stretch_is_still_refused(self):
        claim = {"kind": "crossings", "options": {"line": [[0.0, 0.5], [1.0, 0.5]]}}
        with mock.patch("scry_vision.crossings.Crossings.observe",
                        return_value=Reading(count=0, samples=[])):
            quiet, _ = _too_quiet("playlist", claim, 30.0, 40, 900)
        self.assertTrue(quiet)
