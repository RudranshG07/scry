import unittest
from unittest import mock

from scry_vision.claims import Reading
from scry_vision.discover import (CANDIDATES, MIN_CROSSINGS, MIN_SAYINGS, assess, assess_audio,
                                  live_candidates, propose_line, propose_phrase)


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
    def _verdict(self, usable=True, counts="vehicles", reason="usable", provisional=False,
                 subjects=12.0):
        return mock.Mock(usable=usable, counts=counts, reason=reason,
                         provisional=provisional, subjects=subjects)

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
    def test_a_busy_scene_is_tried_for_lines_even_when_occupancy_calls_it_quiet(self):
        # Occupancy is the wrong yardstick for a line claim: Bangkok's Sukhumvit
        # Road at midday came back provisional on subjects in frame while
        # plainly passing hundreds over a window.
        with mock.patch("scry_vision.probe.resolve", return_value="playlist"), \
             mock.patch("scry_vision.qualify.inspect",
                        return_value=mock.Mock(usable=True, provisional=True, subjects=12.0,
                                               counts="vehicles", reason="quiet enough")), \
             mock.patch("scry_vision.discover.propose_line",
                        return_value=([[0.05, 0.5], [0.95, 0.5]], 9, "across the middle")):
            out = assess("https://example.com/live", seconds=1)
        self.assertTrue(out["usable"], out["reason"])

    def test_a_camera_that_is_merely_empty_now_is_not_tried_for_lines(self):
        with mock.patch("scry_vision.probe.resolve", return_value="playlist"), \
             mock.patch("scry_vision.qualify.inspect",
                        return_value=mock.Mock(usable=True, provisional=True, subjects=0.9,
                                               counts="people", reason="nothing much in view right now")), \
             mock.patch("scry_vision.discover.propose_line") as lines:
            out = assess("https://example.com/live", seconds=1)
        self.assertFalse(out["usable"])
        lines.assert_not_called()


class PhraseProposalTest(unittest.TestCase):
    """What a talking stream should count is measured, not chosen.

    Nobody can search for a catchphrase; only the person talking decides what
    they repeat. These cases are the ones real streams actually produced.
    """

    def _heard(self, text, seconds=70.0):
        return mock.patch("scry_vision.phrases.listen", return_value=(text, seconds))

    def test_a_repeated_catchphrase_is_what_comes_back(self):
        with self._heard("hello guys welcome hello guys today hello guys"):
            phrase, count, _ = propose_phrase("playlist", 70)
        self.assertEqual(phrase, "hello guys")
        self.assertEqual(count, 3)

    def test_news_copy_offers_nothing_to_bet_on(self):
        # A live news stream proposed "the failure of", said twice in fifty
        # seconds, which is how English repeats rather than how someone talks.
        with self._heard("the failure of the plan and the failure of the talks"):
            out = assess_audio("https://example.com/live", 50)
        self.assertFalse(out["usable"])

    def test_contraction_fragments_are_not_phrases(self):
        # Talk radio proposed "ve got" and "she s" until apostrophes stopped
        # splitting words apart.
        with self._heard("we've got it we've got it we've got it"):
            phrase, _, _ = propose_phrase("playlist", 70)
        self.assertNotIn(" s", f" {phrase}")
        self.assertFalse(phrase.split()[0] in ("s", "ve", "re", "ll", "t"))

    def test_a_silent_stream_is_refused(self):
        with mock.patch("scry_vision.phrases.listen", return_value=("", 0.0)):
            out = assess_audio("https://example.com/live", 70)
        self.assertFalse(out["usable"])

    def test_speech_that_never_repeats_is_refused(self):
        with self._heard("every single word here occurs exactly one time only"):
            out = assess_audio("https://example.com/live", 70)
        self.assertFalse(out["usable"])

    def test_a_qualifying_stream_comes_back_as_a_phrase_claim(self):
        with self._heard("hello guys " * 5), \
             mock.patch("scry_vision.probe.resolve", return_value="playlist"):
            out = assess_audio("https://example.com/live", 70)
        self.assertTrue(out["usable"])
        self.assertEqual(out["claim"]["kind"], "phrase")
        self.assertEqual(out["claim"]["target"], "hello guys")
        self.assertEqual(out["category"], "Speech")
