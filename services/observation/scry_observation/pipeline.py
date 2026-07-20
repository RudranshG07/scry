import json
from datetime import datetime
from typing import Any

from .consensus import resolve_observation
from .evidence import build_commitment, canonical_json
from .health import evaluate_stream_health
from .models import (
    EvidenceArtifact,
    EvidenceBundle,
    HealthPolicy,
    HealthSample,
    ObservationWindow,
    ObserverResult,
    ObserverRole,
    OutcomeBand,
    ResolutionPolicy,
)


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def execute_observation(document: dict[str, Any]) -> dict[str, Any]:
    window = ObservationWindow(
        starts_at=parse_timestamp(document["window"]["startsAt"]),
        ends_at=parse_timestamp(document["window"]["endsAt"]),
    )
    health_config = document.get("healthPolicy", {})
    health_policy = HealthPolicy(
        minimum_uptime=health_config.get("minimumUptime", 0.99),
        maximum_timestamp_drift_ms=health_config.get("maximumTimestampDriftMs", 500),
        minimum_visibility=health_config.get("minimumVisibility", 0.90),
        maximum_frozen_seconds=health_config.get("maximumFrozenSeconds", 2),
        expected_sample_interval_ms=health_config.get("expectedSampleIntervalMs", 1000),
    )
    observer_results: list[ObserverResult] = []
    for observer in document["observers"]:
        samples = [
            HealthSample(
                source_timestamp=parse_timestamp(sample["sourceTimestamp"]),
                received_timestamp=parse_timestamp(sample["receivedTimestamp"]),
                visibility=sample["visibility"],
                frame_fingerprint=sample["frameFingerprint"],
                count=sample["count"],
                manipulation_suspected=sample.get("manipulationSuspected", False),
            )
            for sample in observer["samples"]
        ]
        observer_results.append(
            ObserverResult(
                observer_id=observer["observerId"],
                role=ObserverRole(observer["role"]),
                value=observer["value"],
                confidence=observer["confidence"],
                model_version=observer["modelVersion"],
                health=evaluate_stream_health(window, samples, health_policy),
            )
        )
    resolution_config = document.get("resolutionPolicy", {})
    decision = resolve_observation(
        observer_results,
        [
            OutcomeBand(
                outcome_id=outcome["outcomeId"],
                minimum=outcome.get("minimum"),
                maximum=outcome.get("maximum"),
            )
            for outcome in document["outcomes"]
        ],
        ResolutionPolicy(
            minimum_observers=resolution_config.get("minimumObservers", 2),
            maximum_value_divergence=resolution_config.get("maximumValueDivergence", 2),
        ),
        evidence_available=document.get("evidenceAvailable", True),
        manipulation_suspected=document.get("manipulationSuspected", False),
    )
    bundle = EvidenceBundle(
        schema_version=document.get("schemaVersion", "scry-observation/1"),
        market_id=document["marketId"],
        stream_id=document["streamId"],
        rule_hash=document["ruleHash"],
        window=window,
        generated_at=parse_timestamp(document["generatedAt"]),
        decision=decision,
        observer_results=tuple(observer_results),
        artifacts=tuple(
            EvidenceArtifact(
                name=artifact["name"],
                media_type=artifact["mediaType"],
                digest=artifact["digest"],
                size_bytes=artifact["sizeBytes"],
            )
            for artifact in document.get("artifacts", [])
        ),
    )
    commitment = build_commitment(bundle)
    return {
        "decision": json.loads(canonical_json(decision)),
        "observerHealth": {
            result.observer_id: json.loads(canonical_json(result.health))
            for result in observer_results
        },
        "commitment": {
            "evidenceRoot": commitment.evidence_root,
            "payloadDigest": commitment.payload_digest,
            "payload": json.loads(commitment.payload),
        },
    }
