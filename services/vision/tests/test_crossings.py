import unittest

from scry_vision.claims import Claim
from scry_vision.crossings import ANYTHING, COUNTABLE, Crossings, classes_for, line_from


def claim(target="car", **options):
    options.setdefault("line", [[0.1, 0.5], [0.9, 0.5]])
    return Claim("s", "crossings", target, options)


class SupportTest(unittest.TestCase):
    def setUp(self):
        self.observer = Crossings()

    def test_it_counts_road_and_pavement_traffic(self):
        for target in ("car", "person", "bicycle", "bus", "truck", "motorcycle"):
            self.assertTrue(self.observer.supports(claim(target)), target)

    def test_a_claim_without_a_line_is_refused(self):
        # The line is the submitter's, and inferring it from motion was wrong
        # every time it was tried.
        self.assertFalse(self.observer.supports(Claim("s", "crossings", "car", {})))

    def test_a_target_the_model_cannot_see_is_refused(self):
        self.assertFalse(self.observer.supports(claim("helicopter")))

    def test_anything_covers_every_countable_class(self):
        self.assertEqual(sorted(classes_for(ANYTHING)), sorted(COUNTABLE.values()))
        self.assertEqual(classes_for("car"), [COUNTABLE["car"]])


class LineTest(unittest.TestCase):
    def test_a_normalised_line_survives_a_change_of_resolution(self):
        # Stored 0-1 so the same claim works when the stream goes 720p to 1080p.
        line = line_from(claim())
        self.assertGreater(line.end.x, line.start.x)
        self.assertEqual(line.start.y, line.end.y)

    def test_a_vertical_line_is_expressible(self):
        line = line_from(claim(line=[[0.5, 0.0], [0.5, 1.0]]))
        self.assertEqual(line.start.x, line.end.x)
        self.assertNotEqual(line.start.y, line.end.y)

    def test_a_missing_or_malformed_line_yields_nothing(self):
        self.assertIsNone(line_from(Claim("s", "crossings", "car", {})))
        self.assertIsNone(line_from(Claim("s", "crossings", "car", {"line": [[0.1, 0.5]]})))


if __name__ == "__main__":
    unittest.main()
