import hashlib
import json
from datetime import UTC, datetime
from statistics import median_low, pstdev
from typing import Any

from .models import CurationDecision, CurationPolicy, CurationReason, MarketCandidate, OutcomeBand


def propose_binary_outcomes(values: tuple[int, ...]) -> tuple[OutcomeBand, OutcomeBand]:
    if len(values) < 2 or any(value < 0 for value in values):
        raise ValueError("At least two non-negative observations are required.")
    threshold = int(median_low(values))
    return (
        OutcomeBand("at-or-below", f"{threshold} or below", maximum=threshold),
        OutcomeBand("above", f"Above {threshold}", minimum=threshold + 1),
    )


def _outcomes_valid(outcomes: tuple[OutcomeBand, ...]) -> bool:
    if len(outcomes) < 2:
        return False
    if len({outcome.outcome_id for outcome in outcomes}) != len(outcomes):
        return False
    ordered = sorted(outcomes, key=lambda outcome: -1 if outcome.minimum is None else outcome.minimum)
    if ordered[0].minimum is not None or ordered[-1].maximum is not None:
        return False
    for current, following in zip(ordered, ordered[1:], strict=False):
        if current.maximum is None or following.minimum is None:
            return False
        if current.maximum + 1 != following.minimum:
            return False
    return True


def _probabilities(candidate: MarketCandidate) -> tuple[tuple[str, float], ...]:
    total = len(candidate.historical_values)
    if total == 0 or not _outcomes_valid(candidate.outcomes):
        return ()
    probabilities = []
    for outcome in candidate.outcomes:
        matches = sum(outcome.contains(value) for value in candidate.historical_values)
        probabilities.append((outcome.outcome_id, round(matches / total, 6)))
    return tuple(probabilities)


def _dispersion(values: tuple[int, ...]) -> float:
    if len(values) < 2:
        return 0
    mean = sum(values) / len(values)
    if mean == 0:
        return 0 if not any(values) else 1
    return round(pstdev(values) / mean, 6)


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _rule_document(candidate: MarketCandidate) -> dict[str, Any]:
    return {
        "schemaVersion": "scry-market-rule/1",
        "marketId": candidate.market_id,
        "streamId": candidate.stream_id,
        "category": candidate.category,
        "question": candidate.question,
        "countingRule": candidate.counting_rule,
        "opensAt": _timestamp(candidate.opens_at),
        "locksAt": _timestamp(candidate.locks_at),
        "observationStartsAt": _timestamp(candidate.observation_starts_at),
        "observationEndsAt": _timestamp(candidate.observation_ends_at),
        "minimumUptime": candidate.minimum_uptime,
        "maximumTimestampDriftMs": candidate.maximum_timestamp_drift_ms,
        "maximumObserverDivergence": candidate.maximum_observer_divergence,
        "outcomes": [
            {
                "outcomeId": outcome.outcome_id,
                "label": outcome.label,
                "minimum": outcome.minimum,
                "maximum": outcome.maximum,
            }
            for outcome in candidate.outcomes
        ],
    }


def rule_hash(candidate: MarketCandidate) -> str:
    payload = json.dumps(_rule_document(candidate), separators=(",", ":"), sort_keys=True).encode("utf-8")
    return f"0x{hashlib.sha256(payload).hexdigest()}"


def evaluate_market(
    candidate: MarketCandidate,
    policy: CurationPolicy = CurationPolicy(),
) -> CurationDecision:
    reasons: list[CurationReason] = []
    if not candidate.stream_qualified:
        reasons.append(CurationReason.STREAM_NOT_QUALIFIED)
    if candidate.privacy_sensitive:
        reasons.append(CurationReason.PRIVACY_SENSITIVE)
    if not candidate.operationally_meaningful:
        reasons.append(CurationReason.OPERATIONAL_VALUE_MISSING)
    if len(candidate.historical_values) < policy.minimum_history_samples:
        reasons.append(CurationReason.INSUFFICIENT_HISTORY)
    probabilities = _probabilities(candidate)
    if not probabilities:
        reasons.append(CurationReason.OUTCOMES_INVALID)
    elif max(probability for _, probability in probabilities) > policy.maximum_dominant_outcome_probability:
        reasons.append(CurationReason.OUTCOME_TOO_PREDICTABLE)
    dispersion = _dispersion(candidate.historical_values)
    if dispersion > policy.maximum_relative_dispersion:
        reasons.append(CurationReason.HISTORY_TOO_NOISY)
    if candidate.estimated_count_error > policy.maximum_estimated_count_error:
        reasons.append(CurationReason.RESOLUTION_ERROR_ABOVE_POLICY)
    if candidate.current_simultaneous_markets >= policy.maximum_simultaneous_markets:
        reasons.append(CurationReason.CADENCE_ABOVE_POLICY)
    if not (
        candidate.opens_at < candidate.locks_at
        and candidate.locks_at <= candidate.observation_starts_at
        and candidate.observation_starts_at < candidate.observation_ends_at
    ):
        reasons.append(CurationReason.TIMELINE_INVALID)
    approved = not reasons
    return CurationDecision(
        market_id=candidate.market_id,
        approved=approved,
        reasons=tuple(reasons),
        rule_hash=rule_hash(candidate) if approved else None,
        outcome_probabilities=probabilities,
        historical_sample_count=len(candidate.historical_values),
        relative_dispersion=dispersion,
    )
