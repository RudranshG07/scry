from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class CountObservation:
    timestamp: datetime
    event_count: int
    interval_seconds: int
    stream_quality: float

    def __post_init__(self) -> None:
        if self.timestamp.tzinfo is None:
            raise ValueError("Count observation timestamp must include a timezone.")
        if self.event_count < 0:
            raise ValueError("Event count cannot be negative.")
        if self.interval_seconds <= 0:
            raise ValueError("Observation interval must be positive.")
        if not 0 <= self.stream_quality <= 1:
            raise ValueError("Stream quality must be between zero and one.")

    @property
    def rate_per_minute(self) -> float:
        return self.event_count * 60 / self.interval_seconds


@dataclass(frozen=True, slots=True)
class ForecastRequest:
    stream_id: str
    as_of: datetime
    horizon_minutes: int
    current_count: int
    threshold: int
    recent_observations: tuple[CountObservation, ...]
    historical_observations: tuple[CountObservation, ...]

    def __post_init__(self) -> None:
        if not self.stream_id:
            raise ValueError("Stream identity is required.")
        if self.as_of.tzinfo is None:
            raise ValueError("Forecast time must include a timezone.")
        if self.horizon_minutes <= 0:
            raise ValueError("Forecast horizon must be positive.")
        if self.current_count < 0 or self.threshold < 0:
            raise ValueError("Counts and thresholds cannot be negative.")
        observations = (*self.recent_observations, *self.historical_observations)
        if any(observation.timestamp >= self.as_of for observation in observations):
            raise ValueError("Forecast inputs must be strictly earlier than forecast time.")


@dataclass(frozen=True, slots=True)
class BaselineConfig:
    recent_weight: float = 0.55
    recent_decay: float = 0.65
    trend_weight: float = 0.20
    overdispersion: float = 1.25
    minimum_stream_quality: float = 0.50

    def __post_init__(self) -> None:
        if not 0 <= self.recent_weight <= 1 or not 0 <= self.trend_weight <= 1:
            raise ValueError("Forecast weights must be between zero and one.")
        if not 0 < self.recent_decay <= 1:
            raise ValueError("Recent decay must be greater than zero and at most one.")
        if self.overdispersion <= 0:
            raise ValueError("Overdispersion must be positive.")
        if not 0 <= self.minimum_stream_quality <= 1:
            raise ValueError("Minimum stream quality must be between zero and one.")


@dataclass(frozen=True, slots=True)
class ForecastFeatures:
    seasonal_rate_per_minute: float
    recent_rate_per_minute: float
    recent_quality: float
    rate_trend_per_minute: float
    matching_history_count: int
    recent_observation_count: int
    weekday: int
    minute_of_day: int


@dataclass(frozen=True, slots=True)
class ForecastPrediction:
    stream_id: str
    as_of: datetime
    horizon_minutes: int
    expected_value: float
    probability_above_threshold: float
    lower_80: float
    upper_80: float
    forecast_rate_per_minute: float
    model_version: str
    feature_version: str
    features: ForecastFeatures


@dataclass(frozen=True, slots=True)
class CalibrationPoint:
    probability: float
    occurred: bool

    def __post_init__(self) -> None:
        if not 0 <= self.probability <= 1:
            raise ValueError("Forecast probability must be between zero and one.")


@dataclass(frozen=True, slots=True)
class CalibrationBucket:
    lower_bound: float
    upper_bound: float
    sample_count: int
    mean_prediction: float
    observed_frequency: float


@dataclass(frozen=True, slots=True)
class CalibrationReport:
    brier_score: float
    sample_count: int
    buckets: tuple[CalibrationBucket, ...]


@dataclass(frozen=True, slots=True)
class BacktestCase:
    request: ForecastRequest
    actual_value: int

    def __post_init__(self) -> None:
        if self.actual_value < 0:
            raise ValueError("Backtest outcome cannot be negative.")


@dataclass(frozen=True, slots=True)
class BacktestReport:
    sample_count: int
    mean_absolute_error: float
    calibration: CalibrationReport
    predictions: tuple[ForecastPrediction, ...]
