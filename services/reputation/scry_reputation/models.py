from dataclasses import dataclass
from enum import StrEnum


class ForecasterKind(StrEnum):
    HUMAN = "Human"
    AGENT = "Agent"


@dataclass(frozen=True, slots=True)
class ResolvedForecast:
    forecaster_id: str
    kind: ForecasterKind
    category: str
    location: str
    horizon_minutes: int
    probability: float
    occurred: bool
    numerical_forecast: float | None = None
    actual_value: float | None = None

    def __post_init__(self) -> None:
        if not self.forecaster_id or not self.category or not self.location:
            raise ValueError("Forecaster identity, category, and location are required.")
        if self.horizon_minutes <= 0:
            raise ValueError("Forecast horizon must be positive.")
        if not 0 <= self.probability <= 1:
            raise ValueError("Forecast probability must be between zero and one.")
        if (self.numerical_forecast is None) != (self.actual_value is None):
            raise ValueError("Numerical forecast and actual value must be provided together.")
        if self.numerical_forecast is not None and (self.numerical_forecast < 0 or self.actual_value < 0):
            raise ValueError("Numerical forecasts and outcomes cannot be negative.")


@dataclass(frozen=True, slots=True)
class LiveForecast:
    forecaster_id: str
    probability: float

    def __post_init__(self) -> None:
        if not self.forecaster_id:
            raise ValueError("Forecaster identity is required.")
        if not 0 <= self.probability <= 1:
            raise ValueError("Forecast probability must be between zero and one.")


@dataclass(frozen=True, slots=True)
class ReputationPolicy:
    minimum_resolved_forecasts: int = 5
    maximum_brier_score: float = 0.30
    calibration_bucket_count: int = 10

    def __post_init__(self) -> None:
        if self.minimum_resolved_forecasts <= 0 or self.calibration_bucket_count <= 0:
            raise ValueError("Reputation sample and bucket counts must be positive.")
        if not 0 <= self.maximum_brier_score <= 1:
            raise ValueError("Maximum Brier score must be between zero and one.")


@dataclass(frozen=True, slots=True)
class ForecasterScore:
    rank: int
    forecaster_id: str
    kind: ForecasterKind
    category: str
    location: str
    horizon_bucket: str
    sample_count: int
    brier_score: float
    calibration_error: float
    numerical_mean_absolute_error: float | None
    composite_score: float
    eligible: bool


@dataclass(frozen=True, slots=True)
class Consensus:
    probability: float | None
    contributor_count: int
    total_weight: float
    forecaster_ids: tuple[str, ...]
