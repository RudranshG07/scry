from dataclasses import asdict
from enum import Enum
from typing import Any

from .evaluator import evaluate_candidate
from .models import ConditionEvaluation, QualificationPolicy, StreamCandidate


def _serializable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _serializable(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [_serializable(item) for item in value]
    return value


def execute_qualification(document: dict[str, Any]) -> dict[str, Any]:
    policy_document = document.get("policy", {})
    policy = QualificationPolicy(
        required_conditions=tuple(policy_document.get("requiredConditions", ["day", "night"])),
        minimum_samples_per_condition=policy_document.get("minimumSamplesPerCondition", 100),
        minimum_precision=policy_document.get("minimumPrecision", 0.95),
        minimum_recall=policy_document.get("minimumRecall", 0.95),
        maximum_count_error=policy_document.get("maximumCountError", 0.05),
        minimum_uptime=policy_document.get("minimumUptime", 0.99),
        maximum_timestamp_drift_p95_ms=policy_document.get("maximumTimestampDriftP95Ms", 500),
        maximum_obstruction_rate=policy_document.get("maximumObstructionRate", 0.05),
        maximum_simultaneous_markets=policy_document.get("maximumSimultaneousMarkets", 2),
    )
    candidate = StreamCandidate(
        stream_id=document["streamId"],
        written_permission=document["writtenPermission"],
        public_derivative_authorized=document["publicDerivativeAuthorized"],
        fixed_geometry=document["fixedGeometry"],
        counting_region_defined=document["countingRegionDefined"],
        privacy_mask_defined=document["privacyMaskDefined"],
        conditions=tuple(
            ConditionEvaluation(
                name=condition["name"],
                sample_count=condition["sampleCount"],
                ground_truth_events=condition["groundTruthEvents"],
                true_positives=condition["truePositives"],
                false_positives=condition["falsePositives"],
                false_negatives=condition["falseNegatives"],
            )
            for condition in document["conditions"]
        ),
        measured_uptime=document["measuredUptime"],
        timestamp_drift_p95_ms=document["timestampDriftP95Ms"],
        obstruction_rate=document["obstructionRate"],
        freeze_detected=document["freezeDetected"],
        loop_detected=document["loopDetected"],
        secondary_evidence_available=document["secondaryEvidenceAvailable"],
        simultaneous_market_count=document["simultaneousMarketCount"],
    )
    return _serializable(asdict(evaluate_candidate(candidate, policy)))
