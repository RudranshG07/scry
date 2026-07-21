from dataclasses import asdict
from datetime import datetime
from enum import Enum
from typing import Any

from .evaluator import evaluate_market
from .models import CurationPolicy, MarketCandidate, OutcomeBand


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _serializable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _serializable(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [_serializable(item) for item in value]
    return value


def execute_curation(document: dict[str, Any]) -> dict[str, Any]:
    policy_document = document.get("policy", {})
    policy = CurationPolicy(
        minimum_history_samples=policy_document.get("minimumHistorySamples", 30),
        maximum_dominant_outcome_probability=policy_document.get("maximumDominantOutcomeProbability", 0.85),
        maximum_relative_dispersion=policy_document.get("maximumRelativeDispersion", 0.60),
        maximum_estimated_count_error=policy_document.get("maximumEstimatedCountError", 0.05),
        maximum_simultaneous_markets=policy_document.get("maximumSimultaneousMarkets", 2),
    )
    candidate = MarketCandidate(
        market_id=document["marketId"],
        stream_id=document["streamId"],
        category=document["category"],
        question=document["question"],
        stream_qualified=document["streamQualified"],
        privacy_sensitive=document["privacySensitive"],
        operationally_meaningful=document["operationallyMeaningful"],
        historical_values=tuple(document["historicalValues"]),
        outcomes=tuple(
            OutcomeBand(
                outcome_id=outcome["outcomeId"],
                label=outcome["label"],
                minimum=outcome.get("minimum"),
                maximum=outcome.get("maximum"),
            )
            for outcome in document["outcomes"]
        ),
        opens_at=_timestamp(document["opensAt"]),
        locks_at=_timestamp(document["locksAt"]),
        observation_starts_at=_timestamp(document["observationStartsAt"]),
        observation_ends_at=_timestamp(document["observationEndsAt"]),
        current_simultaneous_markets=document["currentSimultaneousMarkets"],
        estimated_count_error=document["estimatedCountError"],
        counting_rule=document["countingRule"],
        minimum_uptime=document["minimumUptime"],
        maximum_timestamp_drift_ms=document["maximumTimestampDriftMs"],
        maximum_observer_divergence=document["maximumObserverDivergence"],
    )
    result = _serializable(asdict(evaluate_market(candidate, policy)))
    result["outcome_probabilities"] = {
        outcome_id: probability
        for outcome_id, probability in result["outcome_probabilities"]
    }
    return result
