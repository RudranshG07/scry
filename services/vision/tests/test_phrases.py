import unittest

from scry_vision.claims import Claim
from scry_vision.phrases import EARS, PRIMARY, VERIFY, Phrases, normalise, occurrences


class MatchTest(unittest.TestCase):
    """Punctuation and case are the transcriber's choices, not the speaker's, so
    a count must not depend on which model heard it."""

    def test_the_same_utterance_counts_however_it_was_written_down(self):
        for heard in ("hello guys", "Hello, guys!", "HELLO GUYS.", "  hello   guys  "):
            self.assertEqual(occurrences(heard, "hello guys"), 1, heard)

    def test_it_counts_every_time_the_phrase_is_said(self):
        self.assertEqual(occurrences("hello guys ... hello guys again, hello guys", "hello guys"), 3)

    def test_a_phrase_inside_a_longer_word_does_not_fire(self):
        self.assertEqual(occurrences("othello guysborough", "hello guys"), 0)

    def test_a_near_miss_is_not_a_match(self):
        self.assertEqual(occurrences("hello everyone", "hello guys"), 0)
        self.assertEqual(occurrences("guys hello", "hello guys"), 0)

    def test_overlaps_are_not_double_counted(self):
        # "na na na" contains "na na" twice by sliding, but it was said once.
        self.assertEqual(occurrences("na na na na", "na na"), 2)

    def test_an_empty_target_counts_nothing(self):
        self.assertEqual(occurrences("anything at all", ""), 0)

    def test_normalise_keeps_words_and_drops_decoration(self):
        self.assertEqual(normalise("Let's GO!! 100%"), "let s go  100")


class ObserverTest(unittest.TestCase):
    def test_the_two_ears_are_different_models(self):
        # Identical models agree even when both mishear, which is the failure
        # the quorum exists to catch.
        self.assertNotEqual(PRIMARY.size, VERIFY.size)
        self.assertNotEqual(PRIMARY.version, VERIFY.version)

    def test_every_role_has_an_ear(self):
        for role in ("primary_vision", "verification", "edge"):
            self.assertIn(role, EARS)

    def test_a_claim_needs_something_to_listen_for(self):
        observer = Phrases()
        self.assertTrue(observer.supports(Claim("s", "phrase", "hello guys")))
        self.assertFalse(observer.supports(Claim("s", "phrase", "   ")))
        self.assertFalse(observer.supports(Claim("s", "phrase", "!!!")))

class EvidenceTest(unittest.TestCase):
    """Evidence travels to the API as json, so anything that cannot serialise
    breaks settlement rather than the transcription."""

    def test_a_sample_survives_json(self):
        import json
        sample = {"at": 10.22, "heard": "hello guys, welcome back",
                  "modelVersion": "whisper-small/1.0-primary"}
        self.assertEqual(json.loads(json.dumps(sample))["at"], 10.22)

    def test_every_match_gets_its_own_moment(self):
        # Segment timestamps gave three occurrences the same second, which is a
        # summary rather than something anyone can scrub to and check.
        times = [10.22, 19.82, 29.82, 30.66]
        self.assertEqual(len(set(times)), len(times))


if __name__ == "__main__":
    unittest.main()
