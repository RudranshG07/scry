from .models import BaselineConfig, ForecastFeatures, ForecastRequest


def _weighted_average(values: list[tuple[float, float]]) -> float:
    total_weight = sum(weight for _, weight in values)
    if total_weight == 0:
        return 0.0
    return sum(value * weight for value, weight in values) / total_weight


def build_features(
    request: ForecastRequest,
    config: BaselineConfig = BaselineConfig(),
) -> ForecastFeatures:
    eligible_history = [
        observation
        for observation in request.historical_observations
        if observation.stream_quality >= config.minimum_stream_quality
    ]
    seasonal_matches = [
        observation
        for observation in eligible_history
        if observation.timestamp.weekday() == request.as_of.weekday()
        and observation.timestamp.hour == request.as_of.hour
    ]
    seasonal_source = seasonal_matches or eligible_history
    seasonal_rate = _weighted_average(
        [
            (observation.rate_per_minute, observation.stream_quality)
            for observation in seasonal_source
        ]
    )
    recent = sorted(
        (
            observation
            for observation in request.recent_observations
            if observation.stream_quality >= config.minimum_stream_quality
        ),
        key=lambda observation: observation.timestamp,
    )
    weighted_recent: list[tuple[float, float]] = []
    for age, observation in enumerate(reversed(recent)):
        weight = observation.stream_quality * config.recent_decay**age
        weighted_recent.append((observation.rate_per_minute, weight))
    recent_rate = _weighted_average(weighted_recent) if weighted_recent else seasonal_rate
    recent_quality = (
        sum(observation.stream_quality for observation in recent) / len(recent)
        if recent
        else 0.0
    )
    trend = 0.0
    if len(recent) >= 2:
        elapsed_minutes = (
            recent[-1].timestamp - recent[0].timestamp
        ).total_seconds() / 60
        if elapsed_minutes > 0:
            trend = (
                recent[-1].rate_per_minute - recent[0].rate_per_minute
            ) / elapsed_minutes
    return ForecastFeatures(
        seasonal_rate_per_minute=round(seasonal_rate, 6),
        recent_rate_per_minute=round(recent_rate, 6),
        recent_quality=round(recent_quality, 6),
        rate_trend_per_minute=round(trend, 6),
        matching_history_count=len(seasonal_source),
        recent_observation_count=len(recent),
        weekday=request.as_of.weekday(),
        minute_of_day=request.as_of.hour * 60 + request.as_of.minute,
    )
