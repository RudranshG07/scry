import json
import unittest
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from scry_curation import CurationPolicy, CurationReason, MarketCandidate, OutcomeBand, evaluate_market, execute_curation, propose_binary_outcomes, rule_hash


def candidate() -> MarketCandidate:
    starts_at = datetime(2026, 7, 21, 13, 30, tzinfo=UTC)
    return MarketCandidate(
        market_id="market-1",
        stream_id="stream-1",
        category="Traffic",
        question="Will the count exceed 105?",
        stream_qualified=True,
        privacy_sensitive=False,
        operationally_meaningful=True,
        historical_values=tuple(range(90, 120)),
        outcomes=(
            OutcomeBand("no", "105 or below", maximum=105),
            OutcomeBand("yes", "Above 105", minimum=106),
        ),
        opens_at=starts_at,
        locks_at=starts_at + timedelta(minutes=5),
        observation_starts_at=starts_at + timedelta(minutes=5),
        observation_ends_at=starts_at + timedelta(minutes=15),
        current_simultaneous_markets=1,
        estimated_count_error=0.03,
        counting_rule="A tracked centroid crosses the inward line once.",
        minimum_uptime=0.99,
        maximum_timestamp_drift_ms=500,
        maximum_observer_divergence=2,
    )


class CurationTests(unittest.TestCase):
    def test_balanced_resolvable_market_is_approved(self) -> None:
        decision = evaluate_market(candidate())
        self.assertTrue(decision.approved)
        self.assertRegex(decision.rule_hash, r"^0x[0-9a-f]{64}$")
        self.assertAlmostEqual(sum(probability for _, probability in decision.outcome_probabilities), 1)

    def test_rule_hash_changes_when_a_committed_rule_changes(self) -> None:
        original = candidate()
        changed = replace(original, minimum_uptime=0.995)
        self.assertNotEqual(rule_hash(original), rule_hash(changed))
        self.assertEqual(rule_hash(original), rule_hash(original))

    def test_obvious_market_is_rejected(self) -> None:
        original = candidate()
        obvious = replace(original, historical_values=tuple(range(1, 31)))
        decision = evaluate_market(obvious)
        self.assertIn(CurationReason.OUTCOME_TOO_PREDICTABLE, decision.reasons)
        self.assertIsNone(decision.rule_hash)

    def test_noisy_or_inaccurate_market_is_rejected(self) -> None:
        original = candidate()
        noisy = replace(original, historical_values=(0, 300) * 15, estimated_count_error=0.08)
        reasons = evaluate_market(noisy).reasons
        self.assertIn(CurationReason.HISTORY_TOO_NOISY, reasons)
        self.assertIn(CurationReason.RESOLUTION_ERROR_ABOVE_POLICY, reasons)

    def test_privacy_meaning_and_cadence_fail_closed(self) -> None:
        original = candidate()
        unsafe = replace(original, stream_qualified=False, privacy_sensitive=True, operationally_meaningful=False, current_simultaneous_markets=2)
        reasons = evaluate_market(unsafe).reasons
        self.assertIn(CurationReason.STREAM_NOT_QUALIFIED, reasons)
        self.assertIn(CurationReason.PRIVACY_SENSITIVE, reasons)
        self.assertIn(CurationReason.OPERATIONAL_VALUE_MISSING, reasons)
        self.assertIn(CurationReason.CADENCE_ABOVE_POLICY, reasons)

    def test_outcome_bands_must_cover_every_integer_once(self) -> None:
        original = candidate()
        invalid = replace(original, outcomes=(OutcomeBand("low", "Low", maximum=100), OutcomeBand("high", "High", minimum=102)))
        self.assertIn(CurationReason.OUTCOMES_INVALID, evaluate_market(invalid).reasons)

    def test_binary_proposal_uses_the_historical_median(self) -> None:
        outcomes = propose_binary_outcomes((10, 12, 14, 16))
        self.assertEqual(outcomes[0].maximum, 12)
        self.assertEqual(outcomes[1].minimum, 13)

    def test_fixture_produces_an_approved_rule(self) -> None:
        path = Path(__file__).parents[1] / "fixtures" / "approved_market.json"
        output = execute_curation(json.loads(path.read_text(encoding="utf-8")))
        self.assertTrue(output["approved"])
        self.assertEqual(output["historical_sample_count"], 40)

    def test_policy_rejects_invalid_limits(self) -> None:
        with self.assertRaises(ValueError):
            CurationPolicy(maximum_dominant_outcome_probability=1.2)


if __name__ == "__main__":
    unittest.main()
