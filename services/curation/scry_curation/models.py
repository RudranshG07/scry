from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class CurationReason(StrEnum):
    STREAM_NOT_QUALIFIED = "stream_not_qualified"
    PRIVACY_SENSITIVE = "privacy_sensitive"
    OPERATIONAL_VALUE_MISSING = "operational_value_missing"
    INSUFFICIENT_HISTORY = "insufficient_history"
    OUTCOMES_INVALID = "outcomes_invalid"
    OUTCOME_TOO_PREDICTABLE = "outcome_too_predictable"
    HISTORY_TOO_NOISY = "history_too_noisy"
    RESOLUTION_ERROR_ABOVE_POLICY = "resolution_error_above_policy"
    CADENCE_ABOVE_POLICY = "cadence_above_policy"
    TIMELINE_INVALID = "timeline_invalid"


@dataclass(frozen=True, slots=True)
class OutcomeBand:
    outcome_id: str
    label: str
    minimum: int | None = None
    maximum: int | None = None

    def __post_init__(self) -> None:
        if not self.outcome_id or not self.label:
            raise ValueError("Outcome identity and label are required.")
        if self.minimum is not None and self.minimum < 0:
            raise ValueError("Outcome minimum cannot be negative.")
        if self.maximum is not None and self.maximum < 0:
            raise ValueError("Outcome maximum cannot be negative.")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Outcome minimum cannot exceed its maximum.")

    def contains(self, value: int) -> bool:
        return (self.minimum is None or value >= self.minimum) and (
            self.maximum is None or value <= self.maximum
        )


@dataclass(frozen=True, slots=True)
class MarketCandidate:
    market_id: str
    stream_id: str
    category: str
    question: str
    stream_qualified: bool
    privacy_sensitive: bool
    operationally_meaningful: bool
    historical_values: tuple[int, ...]
    outcomes: tuple[OutcomeBand, ...]
    opens_at: datetime
    locks_at: datetime
    observation_starts_at: datetime
    observation_ends_at: datetime
    current_simultaneous_markets: int
    estimated_count_error: float
    counting_rule: str
    minimum_uptime: float
    maximum_timestamp_drift_ms: float
    maximum_observer_divergence: int

    def __post_init__(self) -> None:
        if not self.market_id or not self.stream_id or not self.category or not self.question or not self.counting_rule:
            raise ValueError("Market identifiers, category, question, and counting rule are required.")
        timestamps = (self.opens_at, self.locks_at, self.observation_starts_at, self.observation_ends_at)
        if any(timestamp.tzinfo is None for timestamp in timestamps):
            raise ValueError("Market timestamps must include a timezone.")
        if any(value < 0 for value in self.historical_values):
            raise ValueError("Historical observations cannot be negative.")
        if self.current_simultaneous_markets < 0 or self.maximum_timestamp_drift_ms < 0 or self.maximum_observer_divergence < 0:
            raise ValueError("Market counts and observation thresholds cannot be negative.")
        if not 0 <= self.estimated_count_error <= 1 or not 0 <= self.minimum_uptime <= 1:
            raise ValueError("Market quality rates must be between zero and one.")


@dataclass(frozen=True, slots=True)
class CurationPolicy:
    minimum_history_samples: int = 30
    maximum_dominant_outcome_probability: float = 0.85
    maximum_relative_dispersion: float = 0.60
    maximum_estimated_count_error: float = 0.05
    maximum_simultaneous_markets: int = 2

    def __post_init__(self) -> None:
        if self.minimum_history_samples < 2 or self.maximum_simultaneous_markets < 1:
            raise ValueError("Curation sample and cadence limits must be valid.")
        rates = (
            self.maximum_dominant_outcome_probability,
            self.maximum_relative_dispersion,
            self.maximum_estimated_count_error,
        )
        if any(not 0 <= value <= 1 for value in rates):
            raise ValueError("Curation rates must be between zero and one.")


@dataclass(frozen=True, slots=True)
class CurationDecision:
    market_id: str
    approved: bool
    reasons: tuple[CurationReason, ...]
    rule_hash: str | None
    outcome_probabilities: tuple[tuple[str, float], ...]
    historical_sample_count: int
    relative_dispersion: float
