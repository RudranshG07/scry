import unittest
from unittest import mock

from datetime import UTC, datetime, timedelta

from scry_vision.probe import verdict
from scry_vision.scenes import scene_for
from scry_vision.calibrate import TOLERANCE_FLOOR, TOLERANCE_PERCENT, agrees, allowed_spread, spread, summarise
from scry_vision.claims import Reading
from scry_vision.worker import (JOIN_GRACE, SETTLED_REFUSALS, StreamMismatch, as_report, at,
                                guard, live_camera, pick, slot)


def market(id_, stream, status="Observing"):
    return {"id": id_, "streamId": stream, "status": status}


class PickTest(unittest.TestCase):
    """An observer watches one camera. Reporting a count for a market on another
    stream would attribute a reading to a place nobody watched."""

    def setUp(self):
        self.markets = [
            market("pune-1", "stream-pune-ev"),
            market("sd-1", "stream-sd-5-28th"),
            market("sd-old", "stream-sd-5-28th", status="Resolved"),
        ]

    def test_picks_only_its_own_stream(self):
        self.assertEqual(pick(self.markets, "stream-sd-5-28th", None)["id"], "sd-1")

    def test_ignores_other_streams_entirely(self):
        self.assertIsNone(pick(self.markets, "stream-nowhere", None))

    def test_ignores_markets_that_are_not_observing(self):
        only_resolved = [market("sd-old", "stream-sd-5-28th", status="Resolved")]
        self.assertIsNone(pick(only_resolved, "stream-sd-5-28th", None))

    def test_named_market_must_also_match_the_stream(self):
        self.assertIsNone(pick(self.markets, "stream-sd-5-28th", "pune-1"))
        self.assertEqual(pick(self.markets, "stream-sd-5-28th", "sd-1")["id"], "sd-1")


class GuardTest(unittest.TestCase):
    def test_refuses_a_market_on_another_stream(self):
        with self.assertRaises(StreamMismatch):
            guard(market("pune-1", "stream-pune-ev"), "stream-sd-5-28th")

    def test_allows_a_market_on_its_own_stream(self):
        guard(market("sd-1", "stream-sd-5-28th"), "stream-sd-5-28th")

class SlotTest(unittest.TestCase):
    """Two counts are only comparable if they cover the same seconds. The slot
    comes from the market so every observer computes the same one."""

    def market(self, starts, ends):
        return {"id": "m", "streamId": "s", "status": "Observing",
                "observationStartsAt": starts, "observationEndsAt": ends}

    def test_both_observers_derive_the_same_slot(self):
        m = self.market("2026-07-30T06:27:03Z", "2026-07-30T06:42:03Z")
        # Same market, same cap, two processes: the pair must be identical.
        self.assertEqual(slot(m, 150), slot(m, 150))

    def test_slot_starts_when_observation_opens_not_when_the_worker_wakes(self):
        m = self.market("2026-07-30T06:27:03Z", "2026-07-30T06:42:03Z")
        opens, _ = slot(m, 150)
        self.assertEqual(opens.isoformat(), "2026-07-30T06:27:03+00:00")

    def test_cap_bounds_a_long_window(self):
        m = self.market("2026-07-30T06:27:03Z", "2026-07-30T06:42:03Z")
        opens, closes = slot(m, 150)
        self.assertEqual((closes - opens).total_seconds(), 150)

    def test_a_window_shorter_than_the_cap_is_not_extended_past_its_end(self):
        m = self.market("2026-07-30T06:27:03Z", "2026-07-30T06:28:03Z")
        _, closes = slot(m, 150)
        self.assertEqual(closes.isoformat(), "2026-07-30T06:28:03+00:00")


class CoverageTest(unittest.TestCase):
    """A market asks how many crossed during its window. Anything less than the
    whole window is a wrong answer, not a partial one."""

    def slot_for(self, minutes):
        starts = datetime(2026, 7, 30, 6, 27, 3, tzinfo=UTC)
        return {"id": "m", "streamId": "s", "status": "Observing",
                "observationStartsAt": starts.isoformat().replace("+00:00", "Z"),
                "observationEndsAt": (starts + timedelta(minutes=minutes))
                                     .isoformat().replace("+00:00", "Z")}

    def test_grace_is_small_next_to_the_window_it_guards(self):
        m = self.slot_for(15)
        opens, closes = slot(m, 900)
        self.assertLess(JOIN_GRACE / (closes - opens).total_seconds(), 0.05)

    def test_slot_never_runs_past_the_declared_window(self):
        m = self.slot_for(15)
        _, closes = slot(m, 3600)
        self.assertEqual(closes, at(m, "observationEndsAt"))


class SpreadTest(unittest.TestCase):
    def test_spread_is_measured_against_the_lower_count(self):
        self.assertAlmostEqual(spread(100, 110), 10.0)
        self.assertAlmostEqual(spread(110, 100), 10.0)

    def test_identical_counts_do_not_disagree(self):
        self.assertEqual(spread(42, 42), 0.0)

    def test_zero_counts_do_not_divide(self):
        self.assertEqual(spread(0, 0), 0.0)


class SummariseTest(unittest.TestCase):
    def summary(self, gaps):
        return summarise([{"ok": True, "spread": g} for g in gaps])

    def test_reports_the_shape_not_just_the_mean(self):
        s = self.summary([5.3, 11.6, 4.0, 14.5])
        self.assertEqual(s["windows"], 4)
        self.assertEqual(s["best"], 4.0)
        self.assertEqual(s["worst"], 14.5)
        self.assertIsNotNone(s["stdev"])

    def test_a_single_window_reports_no_stdev_rather_than_zero(self):
        # One window looks perfectly consistent, which is exactly the false
        # confidence this tool exists to prevent.
        self.assertIsNone(self.summary([7.0])["stdev"])

    def test_failed_windows_are_counted_not_averaged_in(self):
        s = summarise([{"ok": True, "spread": 4.0}, {"ok": False, "reason": "no frames"}])
        self.assertEqual(s["windows"], 1)
        self.assertEqual(s["failed"], 1)

    def test_no_usable_windows_is_reported_as_none(self):
        self.assertEqual(summarise([{"ok": False, "reason": "x"}])["windows"], 0)


class RelayTest(unittest.TestCase):
    """Observers on one stream must read the same frames. Deriving the url from
    the stream id means two of them cannot end up on different sources."""

    def url(self, relay, stream):
        return f"{relay.rstrip('/')}/{stream}/index.m3u8"

    def test_both_observers_derive_the_same_relay_url(self):
        a = self.url("http://127.0.0.1:8888", "stream-sd-8-15")
        b = self.url("http://127.0.0.1:8888/", "stream-sd-8-15")
        self.assertEqual(a, b)
        self.assertEqual(a, "http://127.0.0.1:8888/stream-sd-8-15/index.m3u8")

    def test_each_stream_gets_its_own_path(self):
        relay = "http://127.0.0.1:8888"
        self.assertNotEqual(self.url(relay, "stream-sd-8-15"), self.url(relay, "stream-sd-5-28th"))

class SettleableTest(unittest.TestCase):
    """A window that lost frames never reaches consensus, so its disagreement is
    not evidence about the detector."""

    def runs(self):
        return [
            {"ok": True, "spread": 10.1, "uptime": 0.88},
            {"ok": True, "spread": 6.1, "uptime": 1.0},
            {"ok": True, "spread": 7.4, "uptime": 1.0},
            {"ok": True, "spread": 16.0, "uptime": 0.88},
            {"ok": True, "spread": 4.8, "uptime": 1.0},
        ]

    def test_degraded_windows_are_excluded_from_the_verdict(self):
        s = summarise(self.runs(), settleable_only=True)
        self.assertEqual(s["windows"], 3)
        self.assertEqual(s["worst"], 7.4)

    def test_counting_them_overstates_the_spread(self):
        everything = summarise(self.runs())
        settleable = summarise(self.runs(), settleable_only=True)
        self.assertGreater(everything["mean"], settleable["mean"])

    def test_no_settleable_window_is_reported_rather_than_averaged_away(self):
        starved = [{"ok": True, "spread": 3.0, "uptime": 0.5}]
        self.assertEqual(summarise(starved, settleable_only=True)["windows"], 0)

class AgreementTest(unittest.TestCase):
    """calibrate must apply the same rule as the resolver, or it reports
    failures the engine would have settled without hesitating."""

    def test_small_counts_are_judged_by_the_floor_not_a_percentage(self):
        # 3 vs 4 is 33% but one event apart. The engine settles it.
        self.assertTrue(agrees(3, 4))
        self.assertEqual(allowed_spread(3), 2)

    def test_large_counts_are_judged_proportionally(self):
        self.assertTrue(agrees(200, 208))
        self.assertFalse(agrees(200, 220))

    def test_the_floor_does_not_become_a_licence_at_volume(self):
        self.assertFalse(agrees(100, 120))

    def test_matches_the_resolver_constants(self):
        self.assertEqual(TOLERANCE_PERCENT, 0.05)
        self.assertEqual(TOLERANCE_FLOOR, 2)

class ProbeVerdictTest(unittest.TestCase):
    """A camera has to earn its place in the pool. The first pool this project
    used delivered ten seconds of video every eight and a half seconds and then
    started returning 403; nothing downstream could tell that from a bad
    detector."""

    def good_net(self):
        return {"ok": True, "realtime_factor": 12.0, "seconds_of_video": 15.0}

    def good_seen(self):
        return {"ok": True, "fps": 30.0, "uptime": 1.0, "frame_gap": 0, "counts": [10, 10]}

    def test_a_healthy_camera_is_accepted(self):
        ok, why = verdict(self.good_net(), self.good_seen())
        self.assertTrue(ok, why)

    def test_barely_keeping_up_is_refused(self):
        # Caltrans sat at 1.16x and held until it did not.
        net = self.good_net() | {"realtime_factor": 1.2}
        ok, why = verdict(net, self.good_seen())
        self.assertFalse(ok)
        self.assertIn("real time", why)

    def test_too_few_frames_to_track_is_refused(self):
        ok, why = verdict(self.good_net(), self.good_seen() | {"fps": 3.2})
        self.assertFalse(ok)

    def test_frame_drift_on_direct_pulls_is_the_relay_s_problem_not_the_source_s(self):
        # Two readers each open their own connection and land on different
        # segment boundaries. Serving both from one ingest removes it, measured
        # at exactly zero, so a small drift does not disqualify the camera.
        ok, why = verdict(self.good_net(), self.good_seen() | {"frame_gap": 44})
        self.assertTrue(ok)
        self.assertIn("relay", why)

    def test_a_scene_the_detector_cannot_see_is_refused(self):
        # A perfect stream where the count line crosses nothing is not usable,
        # and saying so beats passing it as healthy.
        ok, why = verdict(self.good_net(), self.good_seen() | {"counts": [0, 0]})
        self.assertFalse(ok)
        self.assertIn("count line", why)

    def test_uptime_that_would_invalidate_every_market_is_refused(self):
        ok, _ = verdict(self.good_net(), self.good_seen() | {"uptime": 0.53})
        self.assertFalse(ok)

    def test_an_unreachable_source_is_refused_with_its_reason(self):
        ok, why = verdict({"ok": False, "reason": "bad status code: 403"}, {})
        self.assertFalse(ok)
        self.assertIn("403", why)

class SceneTest(unittest.TestCase):
    def test_an_unknown_stream_falls_back_to_the_freeway_preset(self):
        self.assertEqual(scene_for("stream-nobody-configured").name, "freeway")

    def test_a_horizontal_line_spans_the_frame_width(self):
        line = scene_for("stream-tokyo-shibuya").line(width=640, height=360)
        self.assertEqual(line.start.y, line.end.y)
        self.assertEqual(line.end.x, 640.0)

    def test_a_vertical_line_is_used_where_traffic_moves_sideways(self):
        """Abbey Road pedestrians travel 2612px sideways against 852px
        vertically, so a horizontal line is perpendicular to the traffic."""
        abbey = scene_for("stream-london-abbey")
        self.assertTrue(abbey.vertical)
        line = abbey.line(width=640, height=360)
        self.assertEqual(line.start.x, line.end.x)
        self.assertNotEqual(line.start.y, line.end.y)

    def test_a_vertical_line_sits_inside_the_span_people_travel(self):
        # Movers covered x=320-633 of 640.
        abbey = scene_for("stream-london-abbey")
        self.assertGreater(abbey.at * 640, 320)
        self.assertLess(abbey.at * 640, 633)

class JoinRaceTest(unittest.TestCase):
    """The engine sets Observing only after observation_starts_at has passed --
    92 seconds late in one measured case. An observer that waits for that status
    has already missed the start of the window it must cover in full, so it
    skipped every market and nothing ever settled."""

    def scheduled(self, status):
        return {"id": "m", "streamId": "s", "status": status,
                "observationStartsAt": "2026-08-01T00:00:00Z",
                "observationEndsAt": "2026-08-01T00:15:00Z"}

    def test_an_observer_takes_position_before_the_window_opens(self):
        for status in ("Open", "Locked"):
            self.assertIsNotNone(pick([self.scheduled(status)], "s", None), status)

    def test_it_still_picks_up_a_window_already_running(self):
        self.assertIsNotNone(pick([self.scheduled("Observing")], "s", None))

    def test_settled_markets_are_left_alone(self):
        # Scheduled is deliberately not here: an observer positions the moment a
        # market exists and waits for the clock, because every status change is
        # another chance to arrive after the window has already opened.
        for status in ("Resolved", "Invalid", "Result proposed", "Challenged"):
            self.assertIsNone(pick([self.scheduled(status)], "s", None), status)

    def test_position_is_taken_from_the_schedule_not_the_status(self):
        # Same schedule regardless of which pre-window status the market is in,
        # so the observer starts counting at the same instant either way.
        self.assertEqual(slot(self.scheduled("Open"), 900),
                         slot(self.scheduled("Observing"), 900))

class EarlyPositionTest(unittest.TestCase):
    def market(self, status):
        return {"id": "m", "streamId": "s", "status": status,
                "observationStartsAt": "2026-08-01T00:00:00Z",
                "observationEndsAt": "2026-08-01T00:15:00Z"}

    def test_an_observer_positions_as_soon_as_a_market_is_scheduled(self):
        # There is nothing to gain by waiting for Open. Every status change is
        # another chance to arrive after the window has already started.
        self.assertIsNotNone(pick([self.market("Scheduled")], "s", None))

class DetectorProfileTest(unittest.TestCase):
    """Two identical detectors agree even when both are wrong, so the profiles
    have to differ in something real."""

    def test_the_profiles_use_different_weights_and_thresholds(self):
        from scry_vision.detector import PRIMARY, VERIFY
        self.assertNotEqual(PRIMARY.weights, VERIFY.weights)
        self.assertNotEqual(PRIMARY.confidence, VERIFY.confidence)
        self.assertNotEqual(PRIMARY.iou, VERIFY.iou)

    def test_the_version_names_the_model_that_produced_the_count(self):
        from scry_vision.detector import PRIMARY, VERIFY
        self.assertIn("yolov8s", PRIMARY.version)
        self.assertIn("yolov8n", VERIFY.version)
        self.assertNotEqual(PRIMARY.version, VERIFY.version)

    def test_people_and_vehicles_are_different_coco_classes(self):
        from scry_vision.detector import PEOPLE, VEHICLES
        self.assertEqual(PEOPLE, (0,))
        self.assertNotIn(0, VEHICLES)

class LinePlacementTest(unittest.TestCase):
    def test_cameras_without_an_override_keep_the_preset(self):
        preset = scene_for("stream-sd-8-15")
        self.assertAlmostEqual(preset.at, 0.6)
        self.assertFalse(preset.vertical)

    def test_an_override_does_not_disturb_the_rest_of_the_scene(self):
        abbey = scene_for("stream-london-abbey")
        self.assertEqual(abbey.unit, "people")
        self.assertEqual(abbey.name, "crossing")

class OccupancyTest(unittest.TestCase):
    """Reading every frame keeps the footage timeline whole; inferring on every
    frame does not fit in real time and the gaps void the window."""

    def counter(self):
        from scry_vision.occupancy import Occupancy
        c = Occupancy.__new__(Occupancy)
        c.role, c.unit, c.samples, c.seen = "primary_vision", "people", [], 0
        return c

    def test_the_settled_value_is_a_mean_not_a_peak(self):
        c = self.counter()
        c.samples = [10, 10, 10, 40]
        self.assertEqual(c.count, 18)
        self.assertEqual(c.peak, 40)

    def test_an_empty_window_counts_zero_rather_than_failing(self):
        self.assertEqual(self.counter().count, 0)

    def test_stride_is_small_enough_to_sample_every_second(self):
        from scry_vision.occupancy import STRIDE
        # At 25fps a stride of 4 still samples six times a second, which a mean
        # over a fifteen minute window cannot notice.
        self.assertLessEqual(STRIDE, 5)

class SubmissionTest(unittest.TestCase):
    """Anyone can paste a link, so a stream qualifies on its own evidence and
    nothing waits on a human choosing a subject or a threshold."""

    def test_a_stream_too_slow_to_keep_up_is_refused(self):
        from scry_vision.qualify import MIN_REALTIME
        self.assertGreaterEqual(MIN_REALTIME, 3.0)

    def test_a_quiet_scene_is_flagged_rather_than_trusted(self):
        # At six subjects one person is 17%, well past the 5% settlement bar,
        # so the result would turn on rounding.
        from scry_vision.qualify import MIN_FOR_PERCENT
        self.assertGreaterEqual(MIN_FOR_PERCENT, 20.0)
        self.assertLess(1 / MIN_FOR_PERCENT, 0.05)

    def test_models_that_disagree_wildly_disqualify_the_scene(self):
        from scry_vision.qualify import MAX_DISAGREEMENT
        self.assertLessEqual(MAX_DISAGREEMENT, 0.2)

    def test_a_verdict_always_carries_a_reason(self):
        from scry_vision.qualify import Verdict
        v = Verdict("https://example/live", False, "could not find a live stream")
        self.assertTrue(v.reason)
        self.assertFalse(v.usable)

class ClaimRoutingTest(unittest.TestCase):
    """A market says what it counts. Falling back to the nearest observer would
    settle a phrase market on whatever the camera happened to see."""

    def test_a_market_without_a_claim_still_counts_crossings(self):
        from scry_vision.worker import claim_of
        c = claim_of({"id": "m"}, "some-stream")
        self.assertEqual(c.kind, "crossings")
        self.assertEqual(c.target, "anything")

    def test_a_phrase_market_keeps_its_words(self):
        from scry_vision.worker import claim_of
        c = claim_of({"claim": {"kind": "phrase", "target": "hello guys"}}, "ishowspeed")
        self.assertEqual(c.label, "phrase:hello guys")

    def test_options_reach_the_observer(self):
        from scry_vision.worker import claim_of
        line = [[0.1, 0.7], [0.9, 0.7]]
        c = claim_of({"claim": {"kind": "crossings", "target": "car",
                                "options": {"line": line}}}, "road-cam")
        self.assertEqual(c.options["line"], line)

    def test_the_claim_is_bound_to_the_stream_being_watched(self):
        # An observer watches one camera; a claim from elsewhere would attribute
        # a count to a place nobody looked at.
        from scry_vision.worker import claim_of
        self.assertEqual(claim_of({"claim": {"kind": "phrase", "target": "x"}}, "abbey").stream_id,
                         "abbey")


if __name__ == "__main__":
    unittest.main()


class ReportTest(unittest.TestCase):
    """A report carries what the reading measured, not a hopeful constant.

    Reporting uptime 1.0 regardless told the resolver every window was fully
    observed, disabling the one check that keeps a count taken over a fraction
    of a window from settling a market.
    """

    def test_uptime_and_evidence_come_from_the_reading(self):
        reading = Reading(count=42, samples=[{"streamQuality": 0.8}],
                          uptime=0.61, evidence_root="0xabc",
                          detail={"frames": 900, "model": "yolov8s/1.0"})
        report = as_report(reading, 300)
        self.assertEqual(report["uptime"], 0.61)
        self.assertEqual(report["evidenceRoot"], "0xabc")
        self.assertEqual(report["count"], 42)

    def test_a_window_that_saw_nothing_does_not_claim_full_uptime(self):
        report = as_report(Reading(0, [], detail={"reason": "stream unreachable"}), 300)
        self.assertEqual(report["uptime"], 0.0)
        self.assertEqual(report["evidenceRoot"], "")


class CameraTest(unittest.TestCase):
    """The playlist is resolved per window, not once at startup.

    A signed playlist expires. The observer kept watching the dead url, frames
    stopped arriving, and every report came back with a count of zero and no
    uptime — which is what a market invalidating for ten days looked like from
    the outside.
    """

    def test_the_relay_is_preferred_when_it_is_serving(self):
        with mock.patch("scry_vision.worker.serving", return_value=True):
            got = live_camera("stream-x", "https://youtube.com/watch?v=a", "http://relay:8888")
        self.assertEqual(got, "http://relay:8888/stream-x/index.m3u8")

    def test_a_relay_that_is_not_serving_does_not_blind_the_observer(self):
        with mock.patch("scry_vision.worker.serving", return_value=False), \
             mock.patch("scry_vision.probe.resolve", return_value="https://cdn/live.m3u8") as resolve:
            got = live_camera("stream-x", "https://youtube.com/watch?v=a", "http://relay:8888",
                              patience=0)
        self.assertEqual(got, "https://cdn/live.m3u8")
        resolve.assert_called_once()

    def test_the_source_is_resolved_again_each_time_it_is_asked_for(self):
        urls = iter(["https://cdn/one.m3u8", "https://cdn/two.m3u8"])
        with mock.patch("scry_vision.worker.serving", return_value=False), \
             mock.patch("scry_vision.probe.resolve", side_effect=lambda _: next(urls)):
            first = live_camera("stream-x", "https://youtube.com/watch?v=a", None)
            second = live_camera("stream-x", "https://youtube.com/watch?v=a", None)
        self.assertNotEqual(first, second)

    def test_nothing_to_watch_reports_nothing_rather_than_guessing(self):
        self.assertIsNone(live_camera("stream-x", None, None))

    def test_it_waits_for_a_relay_that_is_still_starting(self):
        """The relay starts its ingest on the first request, so the first ask
        always fails. Taking that as final sent both observers off to run yt-dlp
        themselves, 254 seconds past the boundary of the window they were in
        position for."""
        answers = iter([False, False, True])
        with mock.patch("scry_vision.worker.serving", side_effect=lambda _: next(answers)), \
             mock.patch("scry_vision.worker.time.sleep"):
            got = live_camera("stream-x", "https://youtube.com/watch?v=a", "http://relay:8888")
        self.assertEqual(got, "http://relay:8888/stream-x/index.m3u8")

    def test_it_gives_up_on_a_relay_that_never_starts(self):
        with mock.patch("scry_vision.worker.serving", return_value=False), \
             mock.patch("scry_vision.probe.resolve", return_value="https://cdn/live.m3u8"), \
             mock.patch("scry_vision.worker.time.sleep"):
            got = live_camera("stream-x", "https://youtube.com/watch?v=a", "http://relay:8888",
                              patience=0.2)
        self.assertEqual(got, "https://cdn/live.m3u8")


class SubmissionTest(unittest.TestCase):
    """A window the API has closed is not counted a second time.

    Only 202 used to finish a market, so a report that arrived late was refused
    with 409 and the observer counted the whole window again — fifteen minutes,
    which is exactly the next window. One late report invalidated every market
    after it.
    """

    def test_a_closed_window_is_not_retried(self):
        self.assertIn(409, SETTLED_REFUSALS)

    def test_a_market_that_is_gone_is_not_retried(self):
        self.assertIn(404, SETTLED_REFUSALS)

    def test_a_server_fault_is_still_worth_retrying(self):
        for status in (500, 502, 503, 504):
            self.assertNotIn(status, SETTLED_REFUSALS)

    def test_success_is_not_in_the_refusal_set(self):
        self.assertNotIn(202, SETTLED_REFUSALS)


class PlaylistTest(unittest.TestCase):
    """An observer is handed one rendition, not the ladder.

    OpenCV cannot open a master playlist: ffmpeg reads the variant list, finds
    no media and returns nothing. The browser wants the master so it can change
    bitrate mid-stream, and pointing both at the same url broke every observer
    while the video on screen looked fine.
    """

    MASTER = "\n".join([
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=290288,RESOLUTION=256x144",
        "https://cdn.example.com/144/index.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=2922155,RESOLUTION=1280x720",
        "https://cdn.example.com/720/index.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=5552610,RESOLUTION=1920x1080",
        "https://cdn.example.com/1080/index.m3u8",
    ])

    def test_the_best_rendition_within_the_ceiling_is_chosen(self):
        from scry_vision.probe import media_playlist

        with mock.patch("scry_vision.probe._fetch", return_value=self.MASTER):
            self.assertEqual(media_playlist("https://cdn.example.com/master.m3u8", 720),
                             "https://cdn.example.com/720/index.m3u8")

    def test_pixels_are_not_thrown_away_by_taking_the_smallest(self):
        from scry_vision.probe import media_playlist

        with mock.patch("scry_vision.probe._fetch", return_value=self.MASTER):
            got = media_playlist("https://cdn.example.com/master.m3u8", 1080)
        self.assertEqual(got, "https://cdn.example.com/1080/index.m3u8")

    def test_a_ladder_that_starts_above_the_ceiling_still_yields_something(self):
        from scry_vision.probe import media_playlist

        with mock.patch("scry_vision.probe._fetch", return_value=self.MASTER):
            self.assertIsNotNone(media_playlist("https://cdn.example.com/master.m3u8", 100))

    def test_a_media_playlist_is_returned_unchanged(self):
        from scry_vision.probe import media_playlist

        media = "#EXTM3U\n#EXTINF:5.0,\nseg0.ts"
        with mock.patch("scry_vision.probe._fetch", return_value=media):
            self.assertEqual(media_playlist("https://cdn.example.com/720/index.m3u8"),
                             "https://cdn.example.com/720/index.m3u8")

    def test_relative_variant_paths_are_made_absolute(self):
        from scry_vision.probe import media_playlist

        master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\n360/index.m3u8"
        with mock.patch("scry_vision.probe._fetch", return_value=master):
            self.assertEqual(media_playlist("https://cdn.example.com/live/master.m3u8"),
                             "https://cdn.example.com/live/360/index.m3u8")


class ThroughputTest(unittest.TestCase):
    """A playlist is recognised by what it contains, not what it is called.

    YouTube serves segments from paths containing "/index.m3u8/", so matching on
    the extension fetched a segment, read its mp4 header as a list of segments,
    and condemned the camera over a url full of nul bytes.
    """

    MEDIA = "\n".join([
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:5",
        "#EXTINF:5.0,",
        "https://cdn.example.com/videoplayback/playlist/index.m3u8/sq/1/file/seg.ts",
    ])

    def test_a_media_playlist_is_not_mistaken_for_a_master(self):
        from scry_vision.probe import throughput

        fetched = []

        def fake_fetch(url):
            fetched.append(url)
            return self.MEDIA

        with mock.patch("scry_vision.probe._fetch", side_effect=fake_fetch), \
             mock.patch("scry_vision.probe._get", return_value=b"x" * 1024):
            out = throughput("https://cdn.example.com/media.m3u8")

        self.assertTrue(out["ok"], out.get("reason"))
        # One fetch: descending into a segment is what broke it.
        self.assertEqual(len(fetched), 1)

    def test_a_master_playlist_is_descended(self):
        from scry_vision.probe import throughput

        master = "\n".join([
            "#EXTM3U",
            "#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=256x144",
            "https://cdn.example.com/144.m3u8",
        ])
        bodies = iter([master, self.MEDIA])
        with mock.patch("scry_vision.probe._fetch", side_effect=lambda _: next(bodies)), \
             mock.patch("scry_vision.probe._get", return_value=b"x" * 1024):
            out = throughput("https://cdn.example.com/master.m3u8")
        self.assertTrue(out["ok"], out.get("reason"))


class CaptureTimeoutTest(unittest.TestCase):
    """Opening a camera has to give up rather than hang.

    OpenCV's ffmpeg backend has two clocks. The options in
    OPENCV_FFMPEG_CAPTURE_OPTIONS go to ffmpeg; the interrupt callback that
    abandons a stalled read is OpenCV's own and listens only to these
    properties. An inspection sweep sat on one camera for seventeen minutes with
    every stream behind it waiting.
    """

    def test_both_timeouts_are_passed_to_the_backend(self):
        import cv2
        from scry_vision.capture import OPEN_TIMEOUT_MS, READ_TIMEOUT_MS, open_capture

        with mock.patch("cv2.VideoCapture") as capture:
            open_capture("playlist")
        _, args, _ = capture.mock_calls[0]
        self.assertEqual(args[0], "playlist")
        self.assertEqual(args[1], cv2.CAP_FFMPEG)
        params = args[2]
        self.assertIn(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, params)
        self.assertIn(cv2.CAP_PROP_READ_TIMEOUT_MSEC, params)
        self.assertEqual(params[params.index(cv2.CAP_PROP_READ_TIMEOUT_MSEC) + 1], READ_TIMEOUT_MS)
        self.assertEqual(params[params.index(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC) + 1], OPEN_TIMEOUT_MS)

    def test_every_capture_site_goes_through_the_helper(self):
        import pathlib

        # A raw cv2.VideoCapture anywhere reintroduces the hang for that path
        # only, which is the hardest kind of regression to notice.
        root = pathlib.Path(__file__).resolve().parents[1] / "scry_vision"
        offenders = [
            path.name for path in root.glob("*.py")
            if path.name != "capture.py" and "cv2.VideoCapture(" in path.read_text()
        ]
        self.assertEqual(offenders, [])


class LateJoinTest(unittest.TestCase):
    """A late join is measured, not discarded.

    The grace was a 20 second cliff, which no laptop can promise: this host
    suspends, and a 500 second sleep returned four hours later. Every window was
    skipped for arriving 60 to 760 seconds late, when most had covered nearly
    all the footage the question was about.
    """

    def test_coverage_scales_the_reported_uptime(self):
        reading = Reading(count=100, samples=[{"streamQuality": 1.0}],
                          uptime=1.0, evidence_root="0xabc", detail={"frames": 900})
        report = as_report(reading, 810)
        # 810 of a 900 second window is 90% covered, so a flawless 1.0 becomes
        # 0.9 and lands under the resolver's floor on its own.
        self.assertEqual(round(report["uptime"] * 0.9, 4), 0.9)

    def test_a_window_mostly_missed_is_not_worth_counting(self):
        from scry_vision.worker import WORTH_COUNTING

        # Half a window covered is below the bar, so the observer waits for the
        # next one rather than spending fifteen minutes on a certain rejection.
        self.assertLess(0.5, WORTH_COUNTING)
        self.assertGreater(WORTH_COUNTING, 0.85)

    def test_the_bar_sits_below_a_flawless_window(self):
        from scry_vision.worker import WORTH_COUNTING

        self.assertLessEqual(WORTH_COUNTING, 1.0)


class SubmittedPayloadTest(unittest.TestCase):
    """Everything the API reads has to be in the body the observer sends.

    as_report built the scene fingerprint and submit() dropped it, so the API
    compared against nothing, scored it maximally distant, and flagged
    scene_changed on every report. No threshold could fix that, because the
    value being compared never left the observer.
    """

    # Fields postObservation decodes and acts on.
    REQUIRED = {
        "observerId", "role", "observedValue", "modelVersion", "uptime",
        "averageVisibility", "invalidReasons", "evidenceRoot", "sceneHash", "counts",
    }

    def test_the_body_carries_every_field_the_api_uses(self):
        import json
        from scry_vision.observer import submit

        reading = Reading(count=42, samples=[{"streamQuality": 1.0}], uptime=1.0,
                          evidence_root="0xabc",
                          detail={"frames": 900, "sceneHash": "d12625216a763f6d",
                                  "model": "yolov8s"})
        sent = {}

        class Response:
            status = 202
            def read(self): return b'{"status":"accepted"}'
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def capture(request, timeout=0):
            sent.update(json.loads(request.data))
            return Response()

        with mock.patch("urllib.request.urlopen", side_effect=capture):
            submit("http://api", "market-1", "vision-01", "primary_vision",
                   as_report(reading, 900))

        missing = self.REQUIRED - set(sent)
        self.assertEqual(missing, set(), f"submit() dropped {missing}")
        self.assertEqual(sent["sceneHash"], "d12625216a763f6d")


class TakesWhateverIsDue(unittest.TestCase):
    """Unpinned, an observer works a queue rather than attending one camera."""

    def window(self, stream, market_id, starts):
        return {"id": market_id, "streamId": stream, "status": "Scheduled",
                "observationStartsAt": starts, "observationEndsAt": starts}

    def test_it_takes_the_soonest_window_on_any_stream(self):
        markets = [
            self.window("stream-b", "b-1", "2026-08-17T20:10:00Z"),
            self.window("stream-a", "a-1", "2026-08-17T19:50:00Z"),
        ]
        self.assertEqual(pick(markets, None, None)["id"], "a-1")

    def test_it_leaves_streams_it_cannot_reach(self):
        markets = [
            self.window("stream-a", "a-1", "2026-08-17T19:50:00Z"),
            self.window("stream-b", "b-1", "2026-08-17T20:10:00Z"),
        ]
        # Claiming the soonest window and then finding no camera for it means
        # sitting out a window nobody else was going to cover either.
        self.assertEqual(pick(markets, None, None, {"stream-b"})["id"], "b-1")
        self.assertIsNone(pick(markets, None, None, set()))

    def test_pinning_still_wins(self):
        markets = [
            self.window("stream-a", "a-1", "2026-08-17T19:50:00Z"),
            self.window("stream-b", "b-1", "2026-08-17T20:10:00Z"),
        ]
        self.assertEqual(pick(markets, "stream-b", None)["id"], "b-1")
