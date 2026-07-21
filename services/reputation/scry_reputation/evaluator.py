from collections import defaultdict
from dataclasses import replace
from math import sqrt

from .models import Consensus, ForecasterKind, ForecasterScore, LiveForecast, ReputationPolicy, ResolvedForecast


def horizon_bucket(minutes: int) -> str:
    if minutes <= 0:
        raise ValueError("Forecast horizon must be positive.")
    if minutes <= 15:
        return "short"
    if minutes <= 60:
        return "medium"
    return "long"


def _calibration_error(forecasts: list[ResolvedForecast], bucket_count: int) -> float:
    buckets: dict[int, list[ResolvedForecast]] = defaultdict(list)
    for forecast in forecasts:
        index = min(bucket_count - 1, int(forecast.probability * bucket_count))
        buckets[index].append(forecast)
    total = len(forecasts)
    error = 0.0
    for values in buckets.values():
        predicted = sum(value.probability for value in values) / len(values)
        observed = sum(value.occurred for value in values) / len(values)
        error += len(values) / total * abs(predicted - observed)
    return error


def rank_forecasters(
    submissions: tuple[ResolvedForecast, ...],
    category: str,
    location: str,
    horizon_minutes: int,
    policy: ReputationPolicy = ReputationPolicy(),
) -> tuple[ForecasterScore, ...]:
    bucket = horizon_bucket(horizon_minutes)
    scoped = [
        submission
        for submission in submissions
        if submission.category == category
        and submission.location == location
        and horizon_bucket(submission.horizon_minutes) == bucket
    ]
    grouped: dict[tuple[str, ForecasterKind], list[ResolvedForecast]] = defaultdict(list)
    for submission in scoped:
        grouped[(submission.forecaster_id, submission.kind)].append(submission)
    scores: list[ForecasterScore] = []
    for (forecaster_id, kind), forecasts in grouped.items():
        sample_count = len(forecasts)
        brier = sum((forecast.probability - float(forecast.occurred)) ** 2 for forecast in forecasts) / sample_count
        calibration = _calibration_error(forecasts, policy.calibration_bucket_count)
        numerical_errors = [
            abs(forecast.numerical_forecast - forecast.actual_value)
            for forecast in forecasts
            if forecast.numerical_forecast is not None
        ]
        numerical_mae = sum(numerical_errors) / len(numerical_errors) if numerical_errors else None
        experience = min(1, sample_count / (policy.minimum_resolved_forecasts * 2))
        composite = 100 * (0.65 * (1 - brier) + 0.25 * (1 - calibration) + 0.10 * experience)
        scores.append(ForecasterScore(
            rank=0,
            forecaster_id=forecaster_id,
            kind=kind,
            category=category,
            location=location,
            horizon_bucket=bucket,
            sample_count=sample_count,
            brier_score=round(brier, 6),
            calibration_error=round(calibration, 6),
            numerical_mean_absolute_error=round(numerical_mae, 6) if numerical_mae is not None else None,
            composite_score=round(composite, 3),
            eligible=sample_count >= policy.minimum_resolved_forecasts and brier <= policy.maximum_brier_score,
        ))
    scores.sort(key=lambda score: (not score.eligible, -score.composite_score, score.brier_score, score.forecaster_id))
    return tuple(replace(score, rank=index) for index, score in enumerate(scores, start=1))


def build_consensus(
    forecasts: tuple[LiveForecast, ...],
    scores: tuple[ForecasterScore, ...],
) -> Consensus:
    if len({forecast.forecaster_id for forecast in forecasts}) != len(forecasts):
        raise ValueError("Live forecasts must have unique forecaster identities.")
    forecast_by_id = {forecast.forecaster_id: forecast for forecast in forecasts}
    weighted: list[tuple[str, float, float]] = []
    for score in scores:
        forecast = forecast_by_id.get(score.forecaster_id)
        if forecast is None or not score.eligible:
            continue
        weight = max(0.01, (1 - score.brier_score) * (1 - score.calibration_error)) * sqrt(score.sample_count)
        weighted.append((score.forecaster_id, forecast.probability, weight))
    total_weight = sum(weight for _, _, weight in weighted)
    if not weighted:
        return Consensus(None, 0, 0, ())
    probability = sum(probability * weight for _, probability, weight in weighted) / total_weight
    return Consensus(
        probability=round(probability, 6),
        contributor_count=len(weighted),
        total_weight=round(total_weight, 6),
        forecaster_ids=tuple(forecaster_id for forecaster_id, _, _ in weighted),
    )
