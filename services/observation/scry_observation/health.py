from math import ceil
from typing import Iterable

from .models import HealthPolicy, HealthReport, HealthSample, InvalidReason, ObservationWindow


def evaluate_stream_health(
    window: ObservationWindow,
    samples: Iterable[HealthSample],
    policy: HealthPolicy,
) -> HealthReport:
    in_window = [
        sample
        for sample in samples
        if window.starts_at <= sample.source_timestamp < window.ends_at
    ]
    expected = max(
        1,
        ceil(window.duration_seconds * 1000 / policy.expected_sample_interval_ms),
    )
    buckets = {
        int(
            (sample.source_timestamp - window.starts_at).total_seconds()
            * 1000
            // policy.expected_sample_interval_ms
        )
        for sample in in_window
    }
    uptime = min(1.0, len(buckets) / expected)
    maximum_drift = max(
        (
            abs((sample.received_timestamp - sample.source_timestamp).total_seconds())
            * 1000
            for sample in in_window
        ),
        default=0.0,
    )
    average_visibility = (
        sum(sample.visibility for sample in in_window) / len(in_window)
        if in_window
        else 0.0
    )
    timestamp_inconsistent = any(
        current.source_timestamp <= previous.source_timestamp
        for previous, current in zip(in_window, in_window[1:], strict=False)
    )
    ordered = sorted(in_window, key=lambda sample: sample.source_timestamp)
    longest_frozen = 0.0
    frozen_started_at = None
    previous_fingerprint = None
    for sample in ordered:
        if sample.frame_fingerprint == previous_fingerprint and frozen_started_at is not None:
            frozen_duration = (sample.source_timestamp - frozen_started_at).total_seconds()
            longest_frozen = max(longest_frozen, frozen_duration)
        else:
            frozen_started_at = sample.source_timestamp
            previous_fingerprint = sample.frame_fingerprint

    reasons: list[InvalidReason] = []
    if uptime < policy.minimum_uptime:
        reasons.append(InvalidReason.INSUFFICIENT_UPTIME)
    if maximum_drift > policy.maximum_timestamp_drift_ms:
        reasons.append(InvalidReason.EXCESSIVE_TIMESTAMP_DRIFT)
    if average_visibility < policy.minimum_visibility:
        reasons.append(InvalidReason.LOW_VISIBILITY)
    if longest_frozen > policy.maximum_frozen_seconds:
        reasons.append(InvalidReason.FROZEN_STREAM)
    if timestamp_inconsistent:
        reasons.append(InvalidReason.TIMESTAMP_INCONSISTENT)
    if any(sample.manipulation_suspected for sample in in_window):
        reasons.append(InvalidReason.MANIPULATION_SUSPECTED)

    return HealthReport(
        uptime=round(uptime, 6),
        maximum_timestamp_drift_ms=round(maximum_drift, 3),
        average_visibility=round(average_visibility, 6),
        longest_frozen_seconds=round(longest_frozen, 3),
        sample_count=len(in_window),
        expected_sample_count=expected,
        reasons=tuple(reasons),
    )
