import json
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from scry_observation import (
    EvidenceBundle,
    HealthPolicy,
    HealthReport,
    HealthSample,
    InvalidReason,
    ObservationWindow,
    ObserverResult,
    ObserverRole,
    OutcomeBand,
    ResolutionDecision,
    ResolutionPolicy,
    ResolutionStatus,
    build_commitment,
    create_artifact,
    evaluate_stream_health,
    evidence_root,
    resolve_observation,
)
from scry_observation.pipeline import execute_observation


def timestamp(second: int) -> datetime:
    return datetime(2026, 7, 20, 13, 50, second, tzinfo=UTC)


def healthy_report() -> HealthReport:
    return HealthReport(
        uptime=1,
        maximum_timestamp_drift_ms=100,
        average_visibility=0.99,
        longest_frozen_seconds=0,
        sample_count=5,
        expected_sample_count=5,
        reasons=(),
    )


class StreamHealthTests(unittest.TestCase):
    def test_healthy_stream_meets_policy(self) -> None:
        window = ObservationWindow(timestamp(0), timestamp(5))
        samples = [
            HealthSample(
                source_timestamp=timestamp(second),
                received_timestamp=timestamp(second) + timedelta(milliseconds=100),
                visibility=0.98,
                frame_fingerprint=f"frame-{second}",
                count=100 + second,
            )
            for second in range(5)
        ]
        report = evaluate_stream_health(window, samples, HealthPolicy())
        self.assertTrue(report.valid)
        self.assertEqual(report.uptime, 1)
        self.assertEqual(report.sample_count, 5)

    def test_health_report_collects_independent_failures(self) -> None:
        window = ObservationWindow(timestamp(0), timestamp(5))
        samples = [
            HealthSample(
                source_timestamp=timestamp(second),
                received_timestamp=timestamp(second) + timedelta(milliseconds=800),
                visibility=0.4,
                frame_fingerprint="frozen",
                count=100,
            )
            for second in range(5)
        ]
        report = evaluate_stream_health(window, samples, HealthPolicy())
        self.assertFalse(report.valid)
        self.assertIn(InvalidReason.EXCESSIVE_TIMESTAMP_DRIFT, report.reasons)
        self.assertIn(InvalidReason.LOW_VISIBILITY, report.reasons)
        self.assertIn(InvalidReason.FROZEN_STREAM, report.reasons)


class ConsensusTests(unittest.TestCase):
    def test_two_healthy_observers_can_outvote_one_failed_path(self) -> None:
        failed = HealthReport(0.2, 900, 0.4, 0, 1, 5, (InvalidReason.INSUFFICIENT_UPTIME,))
        results = [
            ObserverResult("edge", ObserverRole.EDGE, 181, 0.98, "edge/1", healthy_report()),
            ObserverResult("primary", ObserverRole.PRIMARY_VISION, 182, 0.97, "vision/1", healthy_report()),
            ObserverResult("verify", ObserverRole.VERIFICATION, 170, 0.60, "verify/1", failed),
        ]
        decision = resolve_observation(
            results,
            [OutcomeBand("yes", minimum=181), OutcomeBand("no", maximum=180)],
            ResolutionPolicy(),
        )
        self.assertEqual(decision.status, ResolutionStatus.PROPOSED)
        self.assertEqual(decision.observed_value, 182)
        self.assertEqual(decision.winning_outcome_id, "yes")
        self.assertEqual(decision.agreeing_observer_ids, ("edge", "primary"))

    def test_divergent_observers_invalidate_the_observation(self) -> None:
        results = [
            ObserverResult("edge", ObserverRole.EDGE, 100, 0.98, "edge/1", healthy_report()),
            ObserverResult("primary", ObserverRole.PRIMARY_VISION, 120, 0.97, "vision/1", healthy_report()),
            ObserverResult("verify", ObserverRole.VERIFICATION, 140, 0.96, "verify/1", healthy_report()),
        ]
        decision = resolve_observation(
            results,
            [OutcomeBand("yes", minimum=110), OutcomeBand("no", maximum=109)],
            ResolutionPolicy(maximum_value_divergence=2),
        )
        self.assertEqual(decision.status, ResolutionStatus.INVALID)
        self.assertIn(InvalidReason.OBSERVER_DIVERGENCE, decision.reasons)

    def test_missing_evidence_invalidates_an_agreed_result(self) -> None:
        results = [
            ObserverResult("edge", ObserverRole.EDGE, 181, 0.98, "edge/1", healthy_report()),
            ObserverResult("primary", ObserverRole.PRIMARY_VISION, 181, 0.97, "vision/1", healthy_report()),
        ]
        decision = resolve_observation(
            results,
            [OutcomeBand("yes", minimum=181), OutcomeBand("no", maximum=180)],
            ResolutionPolicy(),
            evidence_available=False,
        )
        self.assertEqual(decision.status, ResolutionStatus.INVALID)
        self.assertIn(InvalidReason.EVIDENCE_UNAVAILABLE, decision.reasons)

    def test_duplicate_observer_roles_do_not_form_independent_quorum(self) -> None:
        results = [
            ObserverResult("primary-a", ObserverRole.PRIMARY_VISION, 181, 0.98, "vision/1", healthy_report()),
            ObserverResult("primary-b", ObserverRole.PRIMARY_VISION, 181, 0.97, "vision/2", healthy_report()),
        ]
        decision = resolve_observation(
            results,
            [OutcomeBand("yes", minimum=181), OutcomeBand("no", maximum=180)],
            ResolutionPolicy(),
        )
        self.assertEqual(decision.status, ResolutionStatus.INVALID)
        self.assertIn(InvalidReason.OBSERVER_SET_INVALID, decision.reasons)


class EvidenceTests(unittest.TestCase):
    def bundle(self, artifacts: tuple) -> EvidenceBundle:
        decision = ResolutionDecision(
            status=ResolutionStatus.PROPOSED,
            observed_value=182,
            winning_outcome_id="yes",
            agreeing_observer_ids=("edge", "primary"),
            reasons=(),
        )
        observers = (
            ObserverResult("edge", ObserverRole.EDGE, 181, 0.98, "edge/1", healthy_report()),
            ObserverResult("primary", ObserverRole.PRIMARY_VISION, 182, 0.97, "vision/1", healthy_report()),
        )
        return EvidenceBundle(
            schema_version="scry-observation/1",
            market_id="market-1",
            stream_id="stream-1",
            rule_hash=f"0x{'a' * 64}",
            window=ObservationWindow(timestamp(0), timestamp(5)),
            generated_at=timestamp(5),
            decision=decision,
            observer_results=observers,
            artifacts=artifacts,
        )

    def test_evidence_root_is_independent_of_artifact_input_order(self) -> None:
        first = create_artifact("timeline.json", "application/json", b"timeline")
        second = create_artifact("health.json", "application/json", b"health")
        self.assertEqual(
            evidence_root(self.bundle((first, second))),
            evidence_root(self.bundle((second, first))),
        )

    def test_commitment_contains_root_and_deterministic_payload_digest(self) -> None:
        artifact = create_artifact("timeline.json", "application/json", b"timeline")
        first = build_commitment(self.bundle((artifact,)))
        second = build_commitment(self.bundle((artifact,)))
        self.assertEqual(first, second)
        self.assertTrue(first.evidence_root.startswith("0x"))
        self.assertEqual(len(first.payload_digest), 66)


class PipelineTests(unittest.TestCase):
    def fixture(self, name: str) -> dict:
        path = Path(__file__).parents[1] / "fixtures" / name
        return json.loads(path.read_text(encoding="utf-8"))

    def test_valid_fixture_proposes_the_expected_outcome(self) -> None:
        output = execute_observation(self.fixture("valid_observation.json"))
        self.assertEqual(output["decision"]["status"], "proposed")
        self.assertEqual(output["decision"]["observed_value"], 182)
        self.assertEqual(output["decision"]["winning_outcome_id"], "yes")
        self.assertIn(
            "insufficient_uptime",
            output["observerHealth"]["observer-verify-01"]["reasons"],
        )

    def test_divergence_fixture_is_invalid(self) -> None:
        output = execute_observation(self.fixture("invalid_divergence.json"))
        self.assertEqual(output["decision"]["status"], "invalid")
        self.assertIn("observer_divergence", output["decision"]["reasons"])


if __name__ == "__main__":
    unittest.main()
