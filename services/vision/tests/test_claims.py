import unittest

from scry_vision.claims import Claim, Reading, kinds, observer_for, register


class Fake:
    def __init__(self, kind, targets):
        self.kind, self._targets = kind, targets

    def supports(self, claim):
        return claim.target in self._targets

    def qualify(self, url, claim, seconds):
        return True, "ok"

    def observe(self, url, claim, seconds, role):
        return Reading(count=1, samples=[])


class RegistryTest(unittest.TestCase):
    def setUp(self):
        register(Fake("crossings", {"car", "person", "bicycle"}))
        register(Fake("phrase", {"hello guys"}))

    def test_a_claim_finds_the_observer_for_its_kind(self):
        self.assertIsNotNone(observer_for(Claim("s", "crossings", "car")))
        self.assertIsNotNone(observer_for(Claim("s", "phrase", "hello guys")))

    def test_an_unknown_kind_has_no_observer_rather_than_a_wrong_one(self):
        # A market nobody can observe must fail loudly at creation, not settle
        # on whatever detector happened to be nearest.
        self.assertIsNone(observer_for(Claim("s", "goals-scored", "any")))

    def test_an_observer_can_refuse_a_target_it_does_not_handle(self):
        self.assertIsNone(observer_for(Claim("s", "crossings", "helicopter")))

    def test_kinds_are_discoverable_without_naming_them(self):
        self.assertIn("crossings", kinds())
        self.assertIn("phrase", kinds())


class ClaimTest(unittest.TestCase):
    def test_a_claim_reads_as_what_it_counts(self):
        self.assertEqual(Claim("s", "phrase", "hello guys").label, "phrase:hello guys")

    def test_options_carry_what_a_kind_needs_without_a_schema_change(self):
        # A crossing needs a line; a phrase needs matching rules. Neither should
        # force a column on the other.
        line = Claim("s", "crossings", "car", {"line": [[0.1, 0.5], [0.9, 0.5]]})
        phrase = Claim("s", "phrase", "hello guys", {"fuzzy": True})
        self.assertIn("line", line.options)
        self.assertIn("fuzzy", phrase.options)

    def test_two_claims_for_the_same_thing_are_equal(self):
        self.assertEqual(Claim("s", "crossings", "car"), Claim("s", "crossings", "car"))
        self.assertNotEqual(Claim("s", "crossings", "car"), Claim("s", "crossings", "bus"))


if __name__ == "__main__":
    unittest.main()
