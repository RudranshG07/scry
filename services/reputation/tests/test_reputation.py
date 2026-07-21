import json
import unittest
from pathlib import Path

from scry_reputation import ForecasterKind, LiveForecast, ReputationPolicy, ResolvedForecast, build_consensus, execute_reputation, horizon_bucket, rank_forecasters


def resolved(forecaster_id: str, probability: float, occurred: bool, location: str = "Gate A", horizon: int = 10) -> ResolvedForecast:
    return ResolvedForecast(forecaster_id, ForecasterKind.HUMAN, "Traffic", location, horizon, probability, occurred)


class ReputationTests(unittest.TestCase):
    def test_perfect_forecaster_ranks_ahead_of_uncertain_forecaster(self) -> None:
        submissions = tuple(
            [resolved("perfect", 1 if occurred else 0, occurred) for occurred in (True, False, True, False, True)]
            + [resolved("uncertain", 0.5, occurred) for occurred in (True, False, True, False, True)]
        )
        scores = rank_forecasters(submissions, "Traffic", "Gate A", 10)
        self.assertEqual(scores[0].forecaster_id, "perfect")
        self.assertEqual(scores[0].brier_score, 0)

    def test_ineligible_forecaster_does_not_enter_consensus(self) -> None:
        scores = rank_forecasters((resolved("new", 0.8, True),), "Traffic", "Gate A", 10)
        consensus = build_consensus((LiveForecast("new", 0.9),), scores)
        self.assertIsNone(consensus.probability)
        self.assertEqual(consensus.contributor_count, 0)

    def test_consensus_weights_eligible_forecasters_by_reliability(self) -> None:
        submissions = tuple(
            [resolved("strong", 0.9 if occurred else 0.1, occurred) for occurred in (True, False, True, False, True)]
            + [resolved("weak", 0.6 if occurred else 0.4, occurred) for occurred in (True, False, True, False, True)]
        )
        scores = rank_forecasters(submissions, "Traffic", "Gate A", 10)
        consensus = build_consensus((LiveForecast("strong", 0.8), LiveForecast("weak", 0.4)), scores)
        self.assertGreater(consensus.probability, 0.6)
        self.assertEqual(consensus.contributor_count, 2)

    def test_scopes_do_not_mix_locations_or_horizons(self) -> None:
        submissions = tuple(
            [resolved("local", 0.8, True) for _ in range(5)]
            + [resolved("remote", 0.8, True, location="Gate B") for _ in range(5)]
            + [resolved("long", 0.8, True, horizon=90) for _ in range(5)]
        )
        scores = rank_forecasters(submissions, "Traffic", "Gate A", 10)
        self.assertEqual([score.forecaster_id for score in scores], ["local"])

    def test_numerical_accuracy_is_reported_when_available(self) -> None:
        submissions = tuple(
            ResolvedForecast("numeric", ForecasterKind.AGENT, "Traffic", "Gate A", 10, 0.7, True, value, 100)
            for value in (98, 99, 100, 101, 102)
        )
        score = rank_forecasters(submissions, "Traffic", "Gate A", 10)[0]
        self.assertEqual(score.numerical_mean_absolute_error, 1.2)

    def test_duplicate_live_forecasts_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            build_consensus((LiveForecast("same", 0.4), LiveForecast("same", 0.6)), ())

    def test_horizon_buckets_are_stable(self) -> None:
        self.assertEqual((horizon_bucket(15), horizon_bucket(16), horizon_bucket(61)), ("short", "medium", "long"))
        with self.assertRaises(ValueError):
            horizon_bucket(0)

    def test_fixture_builds_ranked_consensus(self) -> None:
        path = Path(__file__).parents[1] / "fixtures" / "traffic_leaderboard.json"
        output = execute_reputation(json.loads(path.read_text(encoding="utf-8")))
        self.assertEqual(output["leaderboard"][0]["forecaster_id"], "atlas-flow")
        self.assertEqual(output["consensus"]["contributor_count"], 2)
        self.assertGreater(output["consensus"]["probability"], 0.65)

    def test_invalid_policy_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ReputationPolicy(minimum_resolved_forecasts=0)


if __name__ == "__main__":
    unittest.main()
