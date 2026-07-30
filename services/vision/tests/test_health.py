import unittest

from scry_vision.health import Health, faults

# Mean frame contrast (grayscale std-dev) sampled over 40 frames from each live
# camera, and from synthetic versions of the failures the gate exists to catch.
# The gate has to split these two groups; anything that rejects a WORKING row is
# throwing away a real observation.
WORKING = {"C023 SB I-5 28th": 68.49, "C057 WB I-8 Rte15": 57.09, "C006 EB I-8 Taylor": 45.93}
DEGENERATE = {"black frame": 0.0, "blown-out white": 0.0, "dense fog": 6.01, "night, few lights": 8.23}


def seen(contrast, frames=100, dropped=0):
    return Health(frames=frames, dropped=dropped, contrast=[contrast])


class VisibilityTest(unittest.TestCase):
    def test_every_working_camera_passes(self):
        for name, contrast in WORKING.items():
            with self.subTest(name):
                self.assertEqual(faults(True, 1.0, seen(contrast).visibility()), [])

    def test_every_degenerate_frame_is_rejected(self):
        for name, contrast in DEGENERATE.items():
            with self.subTest(name):
                self.assertIn("visibility_below_minimum",
                              faults(True, 1.0, seen(contrast).visibility()))

    def test_the_floor_sits_in_the_gap_not_against_either_group(self):
        """A threshold tuned to just clear the worst good camera would reject the
        next slightly flatter one. It has to sit in the empty space between."""
        worst_good = seen(min(WORKING.values())).visibility()
        best_bad = seen(max(DEGENERATE.values())).visibility()
        self.assertGreater(worst_good / best_bad, 3.0)

    def test_no_frames_is_not_treated_as_perfect_visibility(self):
        self.assertEqual(Health().visibility(), 0.0)


class UptimeTest(unittest.TestCase):
    def test_dropped_frames_count_against_uptime(self):
        self.assertAlmostEqual(Health(frames=90, dropped=10).uptime(30), 0.9)

    def test_a_stream_that_dropped_frames_cannot_settle_a_market(self):
        h = seen(60.0, frames=90, dropped=10)
        self.assertIn("uptime_below_minimum", faults(True, h.uptime(30), h.visibility()))

    def test_unavailable_evidence_is_reported_even_on_clean_footage(self):
        self.assertIn("evidence_unavailable", faults(False, 1.0, 1.0))


if __name__ == "__main__":
    unittest.main()
