from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class Severity(StrEnum):
    WARNING = "warning"
    CRITICAL = "critical"


class AlertCode(StrEnum):
    STREAM_UPTIME = "stream_uptime_below_policy"
    TIMESTAMP_DRIFT = "timestamp_drift_above_policy"
    OBSERVER_DIVERGENCE = "observer_divergence"
    EVIDENCE_UNAVAILABLE = "evidence_unavailable"
    RESOLUTION_LATENCY = "resolution_latency_above_policy"
    INDEX_LAG = "chain_index_lag"
    TREASURY_EXPOSURE = "treasury_exposure_above_cap"
    INVALID_RATE = "invalid_market_rate_above_policy"


@dataclass(frozen=True, slots=True)
class OperationsPolicy:
    minimum_stream_uptime: float = 0.99
    maximum_timestamp_drift_ms: float = 500
    maximum_observer_divergence: int = 2
    maximum_resolution_latency_seconds: int = 900
    maximum_index_lag_blocks: int = 12
    maximum_treasury_exposure_usdc: float = 10_000
    maximum_invalid_market_rate: float = 0.02

    def __post_init__(self) -> None:
        if not 0 <= self.minimum_stream_uptime <= 1:
            raise ValueError("Minimum stream uptime must be between zero and one.")
        if self.maximum_timestamp_drift_ms < 0 or self.maximum_observer_divergence < 0:
            raise ValueError("Observation thresholds cannot be negative.")
        if self.maximum_resolution_latency_seconds < 0 or self.maximum_index_lag_blocks < 0:
            raise ValueError("Operational latency thresholds cannot be negative.")
        if self.maximum_treasury_exposure_usdc < 0:
            raise ValueError("Treasury exposure cap cannot be negative.")
        if not 0 <= self.maximum_invalid_market_rate <= 1:
            raise ValueError("Invalid market rate must be between zero and one.")


@dataclass(frozen=True, slots=True)
class OperationalSnapshot:
    recorded_at: datetime
    stream_id: str
    market_id: str | None
    stream_uptime: float
    timestamp_drift_ms: float
    observer_values: tuple[int, ...]
    evidence_available: bool
    resolution_latency_seconds: float | None
    index_lag_blocks: int
    treasury_exposure_usdc: float
    invalid_market_rate: float

    def __post_init__(self) -> None:
        if self.recorded_at.tzinfo is None:
            raise ValueError("Operational snapshot time must include a timezone.")
        if not self.stream_id:
            raise ValueError("Stream identity is required.")
        if not 0 <= self.stream_uptime <= 1 or not 0 <= self.invalid_market_rate <= 1:
            raise ValueError("Operational rates must be between zero and one.")
        if self.timestamp_drift_ms < 0 or self.index_lag_blocks < 0 or self.treasury_exposure_usdc < 0:
            raise ValueError("Operational measurements cannot be negative.")
        if self.resolution_latency_seconds is not None and self.resolution_latency_seconds < 0:
            raise ValueError("Resolution latency cannot be negative.")
        if any(value < 0 for value in self.observer_values):
            raise ValueError("Observer values cannot be negative.")


@dataclass(frozen=True, slots=True)
class Alert:
    code: AlertCode
    severity: Severity
    resource_id: str
    message: str
    measured_value: float | int | None
    threshold: float | int | None
    fingerprint: str
    recorded_at: datetime
