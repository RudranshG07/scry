from dataclasses import asdict
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from .evaluator import evaluate_operations
from .models import OperationsPolicy, OperationalSnapshot


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _serializable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _serializable(item) for key, item in value.items()}
    return value


def execute_operations(document: dict[str, Any]) -> dict[str, Any]:
    policy_document = document.get("policy", {})
    policy = OperationsPolicy(
        minimum_stream_uptime=policy_document.get("minimumStreamUptime", 0.99),
        maximum_timestamp_drift_ms=policy_document.get("maximumTimestampDriftMs", 500),
        maximum_observer_divergence=policy_document.get("maximumObserverDivergence", 2),
        maximum_resolution_latency_seconds=policy_document.get("maximumResolutionLatencySeconds", 900),
        maximum_index_lag_blocks=policy_document.get("maximumIndexLagBlocks", 12),
        maximum_treasury_exposure_usdc=policy_document.get("maximumTreasuryExposureUsdc", 10_000),
        maximum_invalid_market_rate=policy_document.get("maximumInvalidMarketRate", 0.02),
    )
    snapshot = OperationalSnapshot(
        recorded_at=_timestamp(document["recordedAt"]),
        stream_id=document["streamId"],
        market_id=document.get("marketId"),
        stream_uptime=document["streamUptime"],
        timestamp_drift_ms=document["timestampDriftMs"],
        observer_values=tuple(document.get("observerValues", [])),
        evidence_available=document["evidenceAvailable"],
        resolution_latency_seconds=document.get("resolutionLatencySeconds"),
        index_lag_blocks=document["indexLagBlocks"],
        treasury_exposure_usdc=document["treasuryExposureUsdc"],
        invalid_market_rate=document["invalidMarketRate"],
    )
    alerts = evaluate_operations(snapshot, policy)
    return {
        "status": "healthy" if not alerts else "attention",
        "criticalCount": sum(alert.severity.value == "critical" for alert in alerts),
        "warningCount": sum(alert.severity.value == "warning" for alert in alerts),
        "alerts": [_serializable(asdict(alert)) for alert in alerts],
    }
