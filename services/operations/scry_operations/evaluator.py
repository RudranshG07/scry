import hashlib

from .models import Alert, AlertCode, OperationsPolicy, OperationalSnapshot, Severity


def _alert(
    snapshot: OperationalSnapshot,
    code: AlertCode,
    severity: Severity,
    message: str,
    measured_value: float | int | None,
    threshold: float | int | None,
) -> Alert:
    resource_id = snapshot.market_id or snapshot.stream_id
    fingerprint = hashlib.sha256(f"{code.value}:{resource_id}".encode("utf-8")).hexdigest()
    return Alert(
        code=code,
        severity=severity,
        resource_id=resource_id,
        message=message,
        measured_value=measured_value,
        threshold=threshold,
        fingerprint=fingerprint,
        recorded_at=snapshot.recorded_at,
    )


def evaluate_operations(
    snapshot: OperationalSnapshot,
    policy: OperationsPolicy = OperationsPolicy(),
) -> tuple[Alert, ...]:
    alerts: list[Alert] = []
    if snapshot.stream_uptime < policy.minimum_stream_uptime:
        alerts.append(_alert(snapshot, AlertCode.STREAM_UPTIME, Severity.CRITICAL, "Stream uptime is below the market policy.", snapshot.stream_uptime, policy.minimum_stream_uptime))
    if snapshot.timestamp_drift_ms > policy.maximum_timestamp_drift_ms:
        alerts.append(_alert(snapshot, AlertCode.TIMESTAMP_DRIFT, Severity.CRITICAL, "Timestamp drift exceeds the observation policy.", snapshot.timestamp_drift_ms, policy.maximum_timestamp_drift_ms))
    if len(snapshot.observer_values) >= 2:
        divergence = max(snapshot.observer_values) - min(snapshot.observer_values)
        if divergence > policy.maximum_observer_divergence:
            alerts.append(_alert(snapshot, AlertCode.OBSERVER_DIVERGENCE, Severity.CRITICAL, "Independent observers disagree beyond tolerance.", divergence, policy.maximum_observer_divergence))
    if not snapshot.evidence_available:
        alerts.append(_alert(snapshot, AlertCode.EVIDENCE_UNAVAILABLE, Severity.CRITICAL, "Required observation evidence is unavailable.", None, None))
    if snapshot.resolution_latency_seconds is not None and snapshot.resolution_latency_seconds > policy.maximum_resolution_latency_seconds:
        alerts.append(_alert(snapshot, AlertCode.RESOLUTION_LATENCY, Severity.WARNING, "Market resolution latency exceeds the beta target.", snapshot.resolution_latency_seconds, policy.maximum_resolution_latency_seconds))
    if snapshot.index_lag_blocks > policy.maximum_index_lag_blocks:
        alerts.append(_alert(snapshot, AlertCode.INDEX_LAG, Severity.WARNING, "The product index is behind the finalized chain head.", snapshot.index_lag_blocks, policy.maximum_index_lag_blocks))
    if snapshot.treasury_exposure_usdc > policy.maximum_treasury_exposure_usdc:
        alerts.append(_alert(snapshot, AlertCode.TREASURY_EXPOSURE, Severity.CRITICAL, "Treasury exposure exceeds the configured beta cap.", snapshot.treasury_exposure_usdc, policy.maximum_treasury_exposure_usdc))
    if snapshot.invalid_market_rate > policy.maximum_invalid_market_rate:
        alerts.append(_alert(snapshot, AlertCode.INVALID_RATE, Severity.WARNING, "Invalid market rate exceeds the stream qualification target.", snapshot.invalid_market_rate, policy.maximum_invalid_market_rate))
    return tuple(alerts)
