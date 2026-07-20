from statistics import median
from typing import Iterable

from .models import (
    InvalidReason,
    ObserverResult,
    OutcomeBand,
    ResolutionDecision,
    ResolutionPolicy,
    ResolutionStatus,
)


def _best_consensus_cluster(
    results: list[ObserverResult],
    maximum_divergence: int,
) -> list[ObserverResult]:
    ordered = sorted(results, key=lambda result: (result.value, result.observer_id))
    best: list[ObserverResult] = []
    for start in range(len(ordered)):
        cluster: list[ObserverResult] = []
        for result in ordered[start:]:
            if result.value - ordered[start].value > maximum_divergence:
                break
            cluster.append(result)
        if len(cluster) > len(best):
            best = cluster
        elif len(cluster) == len(best) and cluster:
            cluster_confidence = sum(result.confidence for result in cluster)
            best_confidence = sum(result.confidence for result in best)
            if cluster_confidence > best_confidence:
                best = cluster
    return best


def resolve_observation(
    observer_results: Iterable[ObserverResult],
    outcomes: Iterable[OutcomeBand],
    policy: ResolutionPolicy,
    *,
    evidence_available: bool = True,
    manipulation_suspected: bool = False,
) -> ResolutionDecision:
    results = list(observer_results)
    unique_results = {result.observer_id: result for result in results}
    eligible = [result for result in unique_results.values() if result.health.valid]
    health_reasons = {
        reason
        for result in unique_results.values()
        for reason in result.health.reasons
    }
    reasons: set[InvalidReason] = set()
    if len(unique_results) != len(results) or len({result.role for result in eligible}) < policy.minimum_observers:
        reasons.add(InvalidReason.OBSERVER_SET_INVALID)
    if not evidence_available:
        reasons.add(InvalidReason.EVIDENCE_UNAVAILABLE)
    if manipulation_suspected:
        reasons.add(InvalidReason.MANIPULATION_SUSPECTED)
    if len(eligible) < policy.minimum_observers or InvalidReason.OBSERVER_SET_INVALID in reasons:
        reasons.update(health_reasons)
        reasons.add(InvalidReason.INSUFFICIENT_OBSERVERS)
        return ResolutionDecision(
            status=ResolutionStatus.INVALID,
            observed_value=None,
            winning_outcome_id=None,
            agreeing_observer_ids=(),
            reasons=tuple(sorted(reasons, key=str)),
        )

    cluster = _best_consensus_cluster(eligible, policy.maximum_value_divergence)
    if len(cluster) < policy.minimum_observers:
        reasons.add(InvalidReason.OBSERVER_DIVERGENCE)
        return ResolutionDecision(
            status=ResolutionStatus.INVALID,
            observed_value=None,
            winning_outcome_id=None,
            agreeing_observer_ids=(),
            reasons=tuple(sorted(reasons, key=str)),
        )

    observed_value = int(median(result.value for result in cluster) + 0.5)
    matching_outcomes = [outcome for outcome in outcomes if outcome.contains(observed_value)]
    if len(matching_outcomes) != 1:
        reasons.add(InvalidReason.OUTCOME_UNRESOLVED)
        return ResolutionDecision(
            status=ResolutionStatus.INVALID,
            observed_value=observed_value,
            winning_outcome_id=None,
            agreeing_observer_ids=tuple(sorted(result.observer_id for result in cluster)),
            reasons=tuple(sorted(reasons, key=str)),
        )
    if reasons:
        return ResolutionDecision(
            status=ResolutionStatus.INVALID,
            observed_value=observed_value,
            winning_outcome_id=None,
            agreeing_observer_ids=tuple(sorted(result.observer_id for result in cluster)),
            reasons=tuple(sorted(reasons, key=str)),
        )
    return ResolutionDecision(
        status=ResolutionStatus.PROPOSED,
        observed_value=observed_value,
        winning_outcome_id=matching_outcomes[0].outcome_id,
        agreeing_observer_ids=tuple(sorted(result.observer_id for result in cluster)),
        reasons=(),
    )
