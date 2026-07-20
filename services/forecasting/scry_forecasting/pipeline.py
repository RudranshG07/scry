from dataclasses import fields, is_dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from .baseline import BaselineForecaster
from .models import BaselineConfig, CountObservation, ForecastRequest


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _serializable(value: Any) -> Any:
    if is_dataclass(value):
        return {
            field.name: _serializable(getattr(value, field.name))
            for field in fields(value)
        }
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, tuple | list):
        return [_serializable(item) for item in value]
    return value


def _observation(document: dict[str, Any]) -> CountObservation:
    return CountObservation(
        timestamp=parse_timestamp(document["timestamp"]),
        event_count=document["eventCount"],
        interval_seconds=document["intervalSeconds"],
        stream_quality=document["streamQuality"],
    )


def execute_forecast(document: dict[str, Any]) -> dict[str, Any]:
    request = ForecastRequest(
        stream_id=document["streamId"],
        as_of=parse_timestamp(document["asOf"]),
        horizon_minutes=document["horizonMinutes"],
        current_count=document["currentCount"],
        threshold=document["threshold"],
        recent_observations=tuple(
            _observation(observation)
            for observation in document.get("recentObservations", [])
        ),
        historical_observations=tuple(
            _observation(observation)
            for observation in document.get("historicalObservations", [])
        ),
    )
    config_data = document.get("config", {})
    config = BaselineConfig(
        recent_weight=config_data.get("recentWeight", 0.55),
        recent_decay=config_data.get("recentDecay", 0.65),
        trend_weight=config_data.get("trendWeight", 0.20),
        overdispersion=config_data.get("overdispersion", 1.25),
        minimum_stream_quality=config_data.get("minimumStreamQuality", 0.50),
    )
    return _serializable(BaselineForecaster(config).predict(request))
