from dataclasses import asdict
from enum import Enum
from typing import Any

from .evaluator import build_consensus, horizon_bucket, rank_forecasters
from .models import ForecasterKind, LiveForecast, ReputationPolicy, ResolvedForecast


def _serializable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _serializable(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [_serializable(item) for item in value]
    return value


def execute_reputation(document: dict[str, Any]) -> dict[str, Any]:
    scope = document["scope"]
    policy_document = document.get("policy", {})
    policy = ReputationPolicy(
        minimum_resolved_forecasts=policy_document.get("minimumResolvedForecasts", 5),
        maximum_brier_score=policy_document.get("maximumBrierScore", 0.30),
        calibration_bucket_count=policy_document.get("calibrationBucketCount", 10),
    )
    submissions = tuple(
        ResolvedForecast(
            forecaster_id=submission["forecasterId"],
            kind=ForecasterKind(submission["kind"]),
            category=submission["category"],
            location=submission["location"],
            horizon_minutes=submission["horizonMinutes"],
            probability=submission["probability"],
            occurred=submission["occurred"],
            numerical_forecast=submission.get("numericalForecast"),
            actual_value=submission.get("actualValue"),
        )
        for submission in document["resolvedForecasts"]
    )
    scores = rank_forecasters(
        submissions,
        scope["category"],
        scope["location"],
        scope["horizonMinutes"],
        policy,
    )
    live = tuple(
        LiveForecast(forecast["forecasterId"], forecast["probability"])
        for forecast in document.get("liveForecasts", [])
    )
    return {
        "scope": {
            "category": scope["category"],
            "location": scope["location"],
            "horizon_bucket": horizon_bucket(scope["horizonMinutes"]),
        },
        "leaderboard": [_serializable(asdict(score)) for score in scores],
        "consensus": _serializable(asdict(build_consensus(live, scores))),
    }
