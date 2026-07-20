from dataclasses import dataclass
from enum import StrEnum


class QualificationReason(StrEnum):
    PERMISSION_MISSING = "permission_missing"
    PUBLIC_DERIVATIVE_NOT_AUTHORIZED = "public_derivative_not_authorized"
    GEOMETRY_UNFIXED = "geometry_unfixed"
    COUNTING_REGION_MISSING = "counting_region_missing"
    PRIVACY_MASK_MISSING = "privacy_mask_missing"
    CONDITION_COVERAGE_INSUFFICIENT = "condition_coverage_insufficient"
    PRECISION_BELOW_POLICY = "precision_below_policy"
    RECALL_BELOW_POLICY = "recall_below_policy"
    COUNT_ERROR_ABOVE_POLICY = "count_error_above_policy"
    UPTIME_BELOW_POLICY = "uptime_below_policy"
    TIMESTAMP_DRIFT_ABOVE_POLICY = "timestamp_drift_above_policy"
    OBSTRUCTION_ABOVE_POLICY = "obstruction_above_policy"
    FREEZE_DETECTED = "freeze_detected"
    LOOP_DETECTED = "loop_detected"
    SECONDARY_EVIDENCE_MISSING = "secondary_evidence_missing"
    CADENCE_ABOVE_POLICY = "cadence_above_policy"


@dataclass(frozen=True, slots=True)
class ConditionEvaluation:
    name: str
    sample_count: int
    ground_truth_events: int
    true_positives: int
    false_positives: int
    false_negatives: int

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("Condition name is required.")
        values = (self.sample_count, self.ground_truth_events, self.true_positives, self.false_positives, self.false_negatives)
        if any(value < 0 for value in values):
            raise ValueError("Condition measurements cannot be negative.")
        if self.true_positives + self.false_negatives != self.ground_truth_events:
            raise ValueError("Ground-truth events must equal true positives plus false negatives.")

    @property
    def predicted_events(self) -> int:
        return self.true_positives + self.false_positives

    @property
    def precision(self) -> float:
        denominator = self.predicted_events
        return 1 if denominator == 0 and self.ground_truth_events == 0 else self.true_positives / max(denominator, 1)

    @property
    def recall(self) -> float:
        return 1 if self.ground_truth_events == 0 else self.true_positives / self.ground_truth_events

    @property
    def count_error(self) -> float:
        return abs(self.predicted_events - self.ground_truth_events) / max(self.ground_truth_events, 1)


@dataclass(frozen=True, slots=True)
class StreamCandidate:
    stream_id: str
    written_permission: bool
    public_derivative_authorized: bool
    fixed_geometry: bool
    counting_region_defined: bool
    privacy_mask_defined: bool
    conditions: tuple[ConditionEvaluation, ...]
    measured_uptime: float
    timestamp_drift_p95_ms: float
    obstruction_rate: float
    freeze_detected: bool
    loop_detected: bool
    secondary_evidence_available: bool
    simultaneous_market_count: int

    def __post_init__(self) -> None:
        if not self.stream_id:
            raise ValueError("Stream identity is required.")
        if not 0 <= self.measured_uptime <= 1 or not 0 <= self.obstruction_rate <= 1:
            raise ValueError("Stream rates must be between zero and one.")
        if self.timestamp_drift_p95_ms < 0 or self.simultaneous_market_count < 0:
            raise ValueError("Stream measurements cannot be negative.")
        names = [condition.name for condition in self.conditions]
        if len(names) != len(set(names)):
            raise ValueError("Condition names must be unique.")


@dataclass(frozen=True, slots=True)
class QualificationPolicy:
    required_conditions: tuple[str, ...] = ("day", "night")
    minimum_samples_per_condition: int = 100
    minimum_precision: float = 0.95
    minimum_recall: float = 0.95
    maximum_count_error: float = 0.05
    minimum_uptime: float = 0.99
    maximum_timestamp_drift_p95_ms: float = 500
    maximum_obstruction_rate: float = 0.05
    maximum_simultaneous_markets: int = 2

    def __post_init__(self) -> None:
        if not self.required_conditions or len(set(self.required_conditions)) != len(self.required_conditions):
            raise ValueError("Required conditions must be non-empty and unique.")
        if self.minimum_samples_per_condition <= 0 or self.maximum_simultaneous_markets <= 0:
            raise ValueError("Qualification counts must be positive.")
        rates = (self.minimum_precision, self.minimum_recall, self.maximum_count_error, self.minimum_uptime, self.maximum_obstruction_rate)
        if any(not 0 <= value <= 1 for value in rates):
            raise ValueError("Qualification rates must be between zero and one.")
        if self.maximum_timestamp_drift_p95_ms < 0:
            raise ValueError("Timestamp drift policy cannot be negative.")


@dataclass(frozen=True, slots=True)
class QualificationDecision:
    stream_id: str
    qualified: bool
    reasons: tuple[QualificationReason, ...]
    precision: float
    recall: float
    count_error: float
    evaluated_conditions: tuple[str, ...]
