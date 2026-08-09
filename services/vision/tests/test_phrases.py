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
        # Contractions close up rather than split. Splitting them left "s" and
        # "ve" behind as words, and talk radio came back proposing "she s" and
        # "ve got" as phrases to run markets on.
        self.assertEqual(normalise("Let's GO!! 100%"), "lets go  100")

    def test_a_contraction_matches_however_it_was_written(self):
        self.assertEqual(occurrences("I don't stop", "dont stop"), 1)
        self.assertEqual(occurrences("I dont stop", "don't stop"), 1)
        # Whisper writes a curly apostrophe; a submitter types a straight one.
        self.assertEqual(occurrences("I don\u2019t stop", "don't stop"), 1)


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


class SampleShapeTest(unittest.TestCase):
    """What a phrase observer reports has to be an observation.

    Samples go two places that both care about their shape: the evidence leaf,
    which reads observedAt, count and intervalSeconds, and the API, which
    decodes them as CountSample. Reporting the transcript entries directly
    crashed the bundle on every window that found anything, and unit tests that
    mock observe() never see it.
    """

    # domain.CountSample in services/api-go/internal/domain/models.go.
    REQUIRED = {"observedAt", "count", "intervalSeconds", "streamQuality", "modelVersion"}

    def _reading(self, hits):
        from unittest import mock

        word = lambda text, start: mock.Mock(word=text, start=start)
        segment = mock.Mock(text=" ".join(w for w, _ in hits) or "quiet",
                            words=[word(w, at) for w, at in hits])
        model = mock.Mock()
        model.transcribe.return_value = ([segment], None)

        with mock.patch("scry_vision.phrases.pull_audio", return_value="/tmp/fake.wav"), \
             mock.patch("scry_vision.phrases.captured", return_value=40.0), \
             mock.patch("scry_vision.phrases._load", return_value=model):
            return Phrases().observe("url", Claim("s", "phrase", "hello guys"), 40, "primary_vision")

    def test_a_sample_carries_every_field_an_observation_needs(self):
        reading = self._reading([("hello", 1.0), ("guys", 1.2)])
        self.assertEqual(len(reading.samples), 1)
        self.assertTrue(self.REQUIRED.issubset(reading.samples[0]))

    def test_the_evidence_bundle_can_be_built_from_them(self):
        from scry_vision.evidence import bundle

        reading = self._reading([("hello", 1.0), ("guys", 1.2)])
        # The bug: this raised KeyError('observedAt') for every match found.
        self.assertEqual(bundle(reading.samples)[0], reading.evidence_root)
        self.assertTrue(reading.evidence_root.startswith("0x"))

    def test_the_count_agrees_with_the_sample(self):
        reading = self._reading([("hello", 1.0), ("guys", 1.2)])
        self.assertEqual(reading.count, 1)
        self.assertEqual(reading.samples[0]["count"], reading.count)

    def test_the_transcript_survives_for_anyone_checking_the_result(self):
        reading = self._reading([("hello", 1.0), ("guys", 1.2)])
        said = reading.detail["said"]
        self.assertEqual(len(said), 1)
        self.assertIn("at", said[0])

    def test_a_window_with_no_match_still_reports_a_usable_sample(self):
        reading = self._reading([("nothing", 1.0), ("here", 1.2)])
        self.assertEqual(reading.count, 0)
        self.assertTrue(self.REQUIRED.issubset(reading.samples[0]))
        self.assertEqual(reading.samples[0]["count"], 0)

    def test_a_short_capture_reports_the_uptime_it_actually_heard(self):
        from unittest import mock

        model = mock.Mock()
        model.transcribe.return_value = ([mock.Mock(text="quiet", words=[])], None)
        with mock.patch("scry_vision.phrases.pull_audio", return_value="/tmp/fake.wav"), \
             mock.patch("scry_vision.phrases.captured", return_value=10.0), \
             mock.patch("scry_vision.phrases._load", return_value=model):
            reading = Phrases().observe("url", Claim("s", "phrase", "hello"), 40, "primary_vision")
        self.assertEqual(reading.uptime, 0.25)
