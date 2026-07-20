import json
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from scry_forecasting import (
    BacktestCase,
    BaselineForecaster,
    CalibrationPoint,
    CountObservation,
    ForecastRequest,
    backtest,
    build_features,
    evaluate_calibration,
)
from scry_forecasting.pipeline import execute_forecast


def moment(minute: int) -> datetime:
    return datetime(2026, 7, 20, 13, minute, tzinfo=UTC)


def observation(minute: int, count: int, quality: float = 0.98) -> CountObservation:
    return CountObservation(moment(minute), count, 60, quality)


def request(threshold: int = 180) -> ForecastRequest:
    historical = tuple(
        CountObservation(
            timestamp=datetime(2026, 7, 13, 13, 40 + index, tzinfo=UTC),
            event_count=10 + index % 3,
            interval_seconds=60,
            stream_quality=0.98,
        )
        for index in range(6)
    )
    return ForecastRequest(
        stream_id="stream-1",
        as_of=moment(50),
        horizon_minutes=5,
        current_count=126,
        threshold=threshold,
        recent_observations=(
            observation(46, 9),
            observation(47, 10),
            observation(48, 11),
            observation(49, 12),
        ),
        historical_observations=historical,
    )


class FeatureTests(unittest.TestCase):
    def test_future_observations_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ForecastRequest(
                stream_id="stream-1",
                as_of=moment(50),
                horizon_minutes=5,
                current_count=100,
                threshold=150,
                recent_observations=(observation(50, 10),),
                historical_observations=(),
            )

    def test_low_quality_recent_observations_are_excluded(self) -> None:
        base = request()
        features = build_features(
            replace(
                base,
                recent_observations=(*base.recent_observations, observation(49, 100, 0.1)),
            )
        )
        self.assertEqual(features.recent_observation_count, 4)
        self.assertLess(features.recent_rate_per_minute, 20)


class BaselineTests(unittest.TestCase):
    def test_forecast_is_deterministic(self) -> None:
        forecaster = BaselineForecaster()
        self.assertEqual(forecaster.predict(request()), forecaster.predict(request()))

    def test_probability_decreases_as_threshold_increases(self) -> None:
        forecaster = BaselineForecaster()
        lower = forecaster.predict(request(170)).probability_above_threshold
        higher = forecaster.predict(request(200)).probability_above_threshold
        self.assertGreater(lower, higher)

    def test_prediction_interval_contains_expected_value(self) -> None:
        prediction = BaselineForecaster().predict(request())
        self.assertLessEqual(prediction.lower_80, prediction.expected_value)
        self.assertGreaterEqual(prediction.upper_80, prediction.expected_value)
        self.assertGreaterEqual(prediction.lower_80, request().current_count)


class CalibrationTests(unittest.TestCase):
    def test_perfect_probabilities_have_zero_brier_score(self) -> None:
        report = evaluate_calibration(
            (
                CalibrationPoint(1, True),
                CalibrationPoint(0, False),
            )
        )
        self.assertEqual(report.brier_score, 0)

    def test_backtest_reports_error_and_calibration(self) -> None:
        cases = (
            BacktestCase(request(180), 190),
            BacktestCase(request(220), 185),
        )
        report = backtest(cases)
        self.assertEqual(report.sample_count, 2)
        self.assertGreaterEqual(report.mean_absolute_error, 0)
        self.assertEqual(report.calibration.sample_count, 2)


class PipelineTests(unittest.TestCase):
    def test_fixture_returns_versioned_probability_forecast(self) -> None:
        path = Path(__file__).parents[1] / "fixtures" / "indore_threshold.json"
        output = execute_forecast(json.loads(path.read_text(encoding="utf-8")))
        self.assertEqual(output["model_version"], "seasonal-ewma/1.0.0")
        self.assertEqual(output["feature_version"], "scry-count-features/1")
        self.assertGreaterEqual(output["probability_above_threshold"], 0)
        self.assertLessEqual(output["probability_above_threshold"], 1)


if __name__ == "__main__":
    unittest.main()
