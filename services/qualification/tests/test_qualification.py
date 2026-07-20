import json
import unittest
from dataclasses import replace
from pathlib import Path

from scry_qualification import ConditionEvaluation, QualificationPolicy, QualificationReason, StreamCandidate, evaluate_candidate, execute_qualification


def condition(name: str, samples: int = 150) -> ConditionEvaluation:
    return ConditionEvaluation(name, samples, 200, 194, 4, 6)


def candidate(**updates) -> StreamCandidate:
    values = {
        "stream_id": "stream-1",
        "written_permission": True,
        "public_derivative_authorized": True,
        "fixed_geometry": True,
        "counting_region_defined": True,
        "privacy_mask_defined": True,
        "conditions": (condition("day"), condition("night")),
        "measured_uptime": 0.998,
        "timestamp_drift_p95_ms": 180,
        "obstruction_rate": 0.01,
        "freeze_detected": False,
        "loop_detected": False,
        "secondary_evidence_available": True,
        "simultaneous_market_count": 2,
    }
    values.update(updates)
    return StreamCandidate(**values)


class QualificationTests(unittest.TestCase):
    def test_qualified_candidate_meets_every_gate(self) -> None:
        decision = evaluate_candidate(candidate())
        self.assertTrue(decision.qualified)
        self.assertEqual(decision.reasons, ())

    def test_missing_conditions_and_accuracy_failures_are_reported(self) -> None:
        weak = ConditionEvaluation("day", 50, 200, 160, 40, 40)
        decision = evaluate_candidate(replace(candidate(), conditions=(weak,)))
        self.assertFalse(decision.qualified)
        self.assertIn(QualificationReason.CONDITION_COVERAGE_INSUFFICIENT, decision.reasons)
        self.assertIn(QualificationReason.PRECISION_BELOW_POLICY, decision.reasons)
        self.assertIn(QualificationReason.RECALL_BELOW_POLICY, decision.reasons)

    def test_permission_privacy_reliability_and_cadence_fail_closed(self) -> None:
        decision = evaluate_candidate(candidate(
            written_permission=False,
            public_derivative_authorized=False,
            fixed_geometry=False,
            counting_region_defined=False,
            privacy_mask_defined=False,
            measured_uptime=0.9,
            timestamp_drift_p95_ms=900,
            obstruction_rate=0.2,
            freeze_detected=True,
            loop_detected=True,
            secondary_evidence_available=False,
            simultaneous_market_count=4,
        ))
        self.assertFalse(decision.qualified)
        self.assertEqual(len(decision.reasons), 12)

    def test_required_weather_condition_can_be_configured(self) -> None:
        decision = evaluate_candidate(candidate(), QualificationPolicy(required_conditions=("day", "night", "rain")))
        self.assertIn(QualificationReason.CONDITION_COVERAGE_INSUFFICIENT, decision.reasons)

    def test_fixture_pipeline_qualifies_the_reference_stream(self) -> None:
        path = Path(__file__).parents[1] / "fixtures" / "qualified_stream.json"
        output = execute_qualification(json.loads(path.read_text(encoding="utf-8")))
        self.assertTrue(output["qualified"])
        self.assertEqual(output["reasons"], [])
        self.assertGreaterEqual(output["precision"], 0.95)


if __name__ == "__main__":
    unittest.main()
