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


class SceneTest(unittest.TestCase):
    """A count line is drawn on a scene, so the scene has to still be there.

    This is the one fault the quorum cannot catch: when a feed cuts to another
    camera both observers see the identical wrong view and agree perfectly.
    """

    def _road(self):
        import cv2
        import numpy as np
        frame = np.zeros((720, 1280, 3), np.uint8)
        frame[:300] = (120, 110, 100)
        frame[300:] = (60, 60, 62)
        cv2.rectangle(frame, (0, 300), (1280, 320), (200, 200, 200), -1)
        for x in range(0, 1280, 160):
            cv2.rectangle(frame, (x, 500), (x + 80, 510), (230, 230, 230), -1)
        cv2.rectangle(frame, (80, 120), (300, 300), (90, 80, 75), -1)
        return frame

    def test_traffic_moving_through_is_the_same_scene(self):
        import cv2
        import numpy as np
        from scry_vision.scene import fingerprint, same_scene

        base = self._road()
        busy = base.copy()
        for x, y in ((400, 560), (700, 600), (1000, 540)):
            cv2.rectangle(busy, (x, y), (x + 90, y + 45), (30, 30, 140), -1)
        self.assertTrue(same_scene(fingerprint(base), fingerprint(busy)))

    def test_nightfall_is_the_same_scene(self):
        import numpy as np
        from scry_vision.scene import fingerprint, same_scene

        base = self._road()
        night = np.clip(base.astype(np.int16) - 55, 0, 255).astype(np.uint8)
        self.assertTrue(same_scene(fingerprint(base), fingerprint(night)))

    def test_the_camera_moving_is_not(self):
        import numpy as np
        from scry_vision.scene import fingerprint, same_scene

        base = self._road()
        panned = np.roll(base, 260, axis=1)
        self.assertFalse(same_scene(fingerprint(base), fingerprint(panned)))

    def test_a_missing_fingerprint_never_matches(self):
        from scry_vision.scene import drift, same_scene

        self.assertEqual(drift("", "95689182cb4fbc3b"), 64)
        self.assertFalse(same_scene("", "95689182cb4fbc3b"))
