from .models import QualificationDecision, QualificationPolicy, QualificationReason, StreamCandidate


def evaluate_candidate(
    candidate: StreamCandidate,
    policy: QualificationPolicy = QualificationPolicy(),
) -> QualificationDecision:
    reasons: list[QualificationReason] = []
    if not candidate.written_permission:
        reasons.append(QualificationReason.PERMISSION_MISSING)
    if not candidate.public_derivative_authorized:
        reasons.append(QualificationReason.PUBLIC_DERIVATIVE_NOT_AUTHORIZED)
    if not candidate.fixed_geometry:
        reasons.append(QualificationReason.GEOMETRY_UNFIXED)
    if not candidate.counting_region_defined:
        reasons.append(QualificationReason.COUNTING_REGION_MISSING)
    if not candidate.privacy_mask_defined:
        reasons.append(QualificationReason.PRIVACY_MASK_MISSING)

    conditions = {condition.name: condition for condition in candidate.conditions}
    if any(
        name not in conditions or conditions[name].sample_count < policy.minimum_samples_per_condition
        for name in policy.required_conditions
    ):
        reasons.append(QualificationReason.CONDITION_COVERAGE_INSUFFICIENT)

    true_positives = sum(condition.true_positives for condition in candidate.conditions)
    predicted_events = sum(condition.predicted_events for condition in candidate.conditions)
    ground_truth_events = sum(condition.ground_truth_events for condition in candidate.conditions)
    precision = 1 if predicted_events == 0 and ground_truth_events == 0 else true_positives / max(predicted_events, 1)
    recall = 1 if ground_truth_events == 0 else true_positives / ground_truth_events
    count_error = abs(predicted_events - ground_truth_events) / max(ground_truth_events, 1)
    if precision < policy.minimum_precision:
        reasons.append(QualificationReason.PRECISION_BELOW_POLICY)
    if recall < policy.minimum_recall:
        reasons.append(QualificationReason.RECALL_BELOW_POLICY)
    if count_error > policy.maximum_count_error:
        reasons.append(QualificationReason.COUNT_ERROR_ABOVE_POLICY)
    if candidate.measured_uptime < policy.minimum_uptime:
        reasons.append(QualificationReason.UPTIME_BELOW_POLICY)
    if candidate.timestamp_drift_p95_ms > policy.maximum_timestamp_drift_p95_ms:
        reasons.append(QualificationReason.TIMESTAMP_DRIFT_ABOVE_POLICY)
    if candidate.obstruction_rate > policy.maximum_obstruction_rate:
        reasons.append(QualificationReason.OBSTRUCTION_ABOVE_POLICY)
    if candidate.freeze_detected:
        reasons.append(QualificationReason.FREEZE_DETECTED)
    if candidate.loop_detected:
        reasons.append(QualificationReason.LOOP_DETECTED)
    if not candidate.secondary_evidence_available:
        reasons.append(QualificationReason.SECONDARY_EVIDENCE_MISSING)
    if candidate.simultaneous_market_count > policy.maximum_simultaneous_markets:
        reasons.append(QualificationReason.CADENCE_ABOVE_POLICY)

    return QualificationDecision(
        stream_id=candidate.stream_id,
        qualified=not reasons,
        reasons=tuple(reasons),
        precision=round(precision, 6),
        recall=round(recall, 6),
        count_error=round(count_error, 6),
        evaluated_conditions=tuple(sorted(conditions)),
    )
