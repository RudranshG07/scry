from math import erf, sqrt

from .features import build_features
from .models import BaselineConfig, ForecastPrediction, ForecastRequest


class BaselineForecaster:
    model_version = "seasonal-ewma/1.0.0"
    feature_version = "scry-count-features/1"

    def __init__(self, config: BaselineConfig = BaselineConfig()) -> None:
        self.config = config

    def predict(self, request: ForecastRequest) -> ForecastPrediction:
        features = build_features(request, self.config)
        quality_adjusted_recent_weight = self.config.recent_weight * features.recent_quality
        base_rate = (
            features.seasonal_rate_per_minute * (1 - quality_adjusted_recent_weight)
            + features.recent_rate_per_minute * quality_adjusted_recent_weight
        )
        trend_adjustment = (
            features.rate_trend_per_minute
            * min(request.horizon_minutes, 10)
            * self.config.trend_weight
        )
        forecast_rate = max(0.0, base_rate + trend_adjustment)
        expected_future = forecast_rate * request.horizon_minutes
        expected_value = request.current_count + expected_future
        standard_deviation = sqrt(max(expected_future * self.config.overdispersion, 1.0))
        threshold_score = (
            request.threshold + 0.5 - expected_value
        ) / standard_deviation
        probability_above = 1 - 0.5 * (1 + erf(threshold_score / sqrt(2)))
        interval_width = 1.2815515655446004 * standard_deviation
        return ForecastPrediction(
            stream_id=request.stream_id,
            as_of=request.as_of,
            horizon_minutes=request.horizon_minutes,
            expected_value=round(expected_value, 6),
            probability_above_threshold=round(min(1.0, max(0.0, probability_above)), 6),
            lower_80=round(max(request.current_count, expected_value - interval_width), 6),
            upper_80=round(expected_value + interval_width, 6),
            forecast_rate_per_minute=round(forecast_rate, 6),
            model_version=self.model_version,
            feature_version=self.feature_version,
            features=features,
        )
