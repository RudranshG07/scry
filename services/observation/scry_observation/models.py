from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class InvalidReason(StrEnum):
    INSUFFICIENT_UPTIME = "insufficient_uptime"
    EXCESSIVE_TIMESTAMP_DRIFT = "excessive_timestamp_drift"
    LOW_VISIBILITY = "low_visibility"
    FROZEN_STREAM = "frozen_stream"
    TIMESTAMP_INCONSISTENT = "timestamp_inconsistent"
    OBSERVER_DIVERGENCE = "observer_divergence"
    INSUFFICIENT_OBSERVERS = "insufficient_observers"
    EVIDENCE_UNAVAILABLE = "evidence_unavailable"
    MANIPULATION_SUSPECTED = "manipulation_suspected"
    OUTCOME_UNRESOLVED = "outcome_unresolved"
    OBSERVER_SET_INVALID = "observer_set_invalid"


class ObserverRole(StrEnum):
    EDGE = "edge"
    PRIMARY_VISION = "primary_vision"
    VERIFICATION = "verification"


class ResolutionStatus(StrEnum):
    PROPOSED = "proposed"
    INVALID = "invalid"


@dataclass(frozen=True, slots=True)
class ObservationWindow:
    starts_at: datetime
    ends_at: datetime

    def __post_init__(self) -> None:
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("Observation timestamps must include a timezone.")
        if self.ends_at <= self.starts_at:
            raise ValueError("Observation window must end after it starts.")

    @property
    def duration_seconds(self) -> float:
        return (self.ends_at - self.starts_at).total_seconds()


@dataclass(frozen=True, slots=True)
class HealthPolicy:
    minimum_uptime: float = 0.99
    maximum_timestamp_drift_ms: float = 500.0
    minimum_visibility: float = 0.90
    maximum_frozen_seconds: float = 2.0
    expected_sample_interval_ms: int = 1000

    def __post_init__(self) -> None:
        if not 0 <= self.minimum_uptime <= 1:
            raise ValueError("Minimum uptime must be between zero and one.")
        if not 0 <= self.minimum_visibility <= 1:
            raise ValueError("Minimum visibility must be between zero and one.")
        if self.maximum_timestamp_drift_ms < 0 or self.maximum_frozen_seconds < 0:
            raise ValueError("Health limits cannot be negative.")
        if self.expected_sample_interval_ms <= 0:
            raise ValueError("Expected sample interval must be positive.")


@dataclass(frozen=True, slots=True)
class HealthSample:
    source_timestamp: datetime
    received_timestamp: datetime
    visibility: float
    frame_fingerprint: str
    count: int
    manipulation_suspected: bool = False

    def __post_init__(self) -> None:
        if self.source_timestamp.tzinfo is None or self.received_timestamp.tzinfo is None:
            raise ValueError("Health sample timestamps must include a timezone.")
        if not 0 <= self.visibility <= 1:
            raise ValueError("Visibility must be between zero and one.")
        if self.count < 0:
            raise ValueError("Count cannot be negative.")
        if not self.frame_fingerprint:
            raise ValueError("Frame fingerprint is required.")


@dataclass(frozen=True, slots=True)
class HealthReport:
    uptime: float
    maximum_timestamp_drift_ms: float
    average_visibility: float
    longest_frozen_seconds: float
    sample_count: int
    expected_sample_count: int
    reasons: tuple[InvalidReason, ...]

    @property
    def valid(self) -> bool:
        return not self.reasons


@dataclass(frozen=True, slots=True)
class ObserverResult:
    observer_id: str
    role: ObserverRole
    value: int
    confidence: float
    model_version: str
    health: HealthReport

    def __post_init__(self) -> None:
        if not self.observer_id or not self.model_version:
            raise ValueError("Observer identity and model version are required.")
        if self.value < 0:
            raise ValueError("Observed value cannot be negative.")
        if not 0 <= self.confidence <= 1:
            raise ValueError("Observer confidence must be between zero and one.")


@dataclass(frozen=True, slots=True)
class OutcomeBand:
    outcome_id: str
    minimum: int | None = None
    maximum: int | None = None

    def __post_init__(self) -> None:
        if not self.outcome_id:
            raise ValueError("Outcome identity is required.")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Outcome minimum cannot exceed its maximum.")

    def contains(self, value: int) -> bool:
        return (self.minimum is None or value >= self.minimum) and (
            self.maximum is None or value <= self.maximum
        )


@dataclass(frozen=True, slots=True)
class ResolutionPolicy:
    minimum_observers: int = 2
    maximum_value_divergence: int = 2

    def __post_init__(self) -> None:
        if self.minimum_observers < 2:
            raise ValueError("At least two observers are required.")
        if self.maximum_value_divergence < 0:
            raise ValueError("Observer divergence cannot be negative.")


@dataclass(frozen=True, slots=True)
class ResolutionDecision:
    status: ResolutionStatus
    observed_value: int | None
    winning_outcome_id: str | None
    agreeing_observer_ids: tuple[str, ...]
    reasons: tuple[InvalidReason, ...]


@dataclass(frozen=True, slots=True)
class EvidenceArtifact:
    name: str
    media_type: str
    digest: str
    size_bytes: int

    def __post_init__(self) -> None:
        if not self.name or not self.media_type:
            raise ValueError("Evidence artifact name and media type are required.")
        if len(self.digest) != 64 or any(character not in "0123456789abcdef" for character in self.digest):
            raise ValueError("Evidence artifact digest must be lowercase SHA-256 hex.")
        if self.size_bytes < 0:
            raise ValueError("Evidence artifact size cannot be negative.")


@dataclass(frozen=True, slots=True)
class EvidenceBundle:
    schema_version: str
    market_id: str
    stream_id: str
    rule_hash: str
    window: ObservationWindow
    generated_at: datetime
    decision: ResolutionDecision
    observer_results: tuple[ObserverResult, ...]
    artifacts: tuple[EvidenceArtifact, ...]

    def __post_init__(self) -> None:
        if self.generated_at.tzinfo is None:
            raise ValueError("Evidence generation time must include a timezone.")
        if not self.schema_version or not self.market_id or not self.stream_id or not self.rule_hash:
            raise ValueError("Evidence bundle identifiers are required.")
        if len(self.rule_hash) != 66 or not self.rule_hash.startswith("0x") or any(
            character not in "0123456789abcdefABCDEF" for character in self.rule_hash[2:]
        ):
            raise ValueError("Rule hash must be 32-byte hexadecimal with a 0x prefix.")
        if self.generated_at < self.window.ends_at:
            raise ValueError("Evidence cannot be generated before observation ends.")
        artifact_names = [artifact.name for artifact in self.artifacts]
        if len(artifact_names) != len(set(artifact_names)):
            raise ValueError("Evidence artifact names must be unique.")
        observer_ids = [result.observer_id for result in self.observer_results]
        if len(observer_ids) != len(set(observer_ids)):
            raise ValueError("Evidence observer identities must be unique.")


@dataclass(frozen=True, slots=True)
class ObservationCommitment:
    evidence_root: str
    payload_digest: str
    payload: bytes
