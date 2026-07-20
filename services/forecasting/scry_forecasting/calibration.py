from .baseline import BaselineForecaster
from .models import (
    BacktestCase,
    BacktestReport,
    CalibrationBucket,
    CalibrationPoint,
    CalibrationReport,
)


def evaluate_calibration(
    points: tuple[CalibrationPoint, ...],
    bucket_count: int = 10,
) -> CalibrationReport:
    if bucket_count <= 0:
        raise ValueError("Calibration bucket count must be positive.")
    if not points:
        return CalibrationReport(brier_score=0, sample_count=0, buckets=())
    brier_score = sum(
        (point.probability - float(point.occurred)) ** 2
        for point in points
    ) / len(points)
    buckets: list[CalibrationBucket] = []
    for index in range(bucket_count):
        lower = index / bucket_count
        upper = (index + 1) / bucket_count
        selected = [
            point
            for point in points
            if lower <= point.probability < upper
            or index == bucket_count - 1 and point.probability == 1
        ]
        if not selected:
            continue
        buckets.append(
            CalibrationBucket(
                lower_bound=lower,
                upper_bound=upper,
                sample_count=len(selected),
                mean_prediction=round(
                    sum(point.probability for point in selected) / len(selected),
                    6,
                ),
                observed_frequency=round(
                    sum(float(point.occurred) for point in selected) / len(selected),
                    6,
                ),
            )
        )
    return CalibrationReport(
        brier_score=round(brier_score, 6),
        sample_count=len(points),
        buckets=tuple(buckets),
    )


def backtest(
    cases: tuple[BacktestCase, ...],
    forecaster: BaselineForecaster | None = None,
) -> BacktestReport:
    model = forecaster or BaselineForecaster()
    predictions = tuple(model.predict(case.request) for case in cases)
    if not cases:
        return BacktestReport(
            sample_count=0,
            mean_absolute_error=0,
            calibration=evaluate_calibration(()),
            predictions=(),
        )
    calibration = evaluate_calibration(
        tuple(
            CalibrationPoint(
                probability=prediction.probability_above_threshold,
                occurred=case.actual_value > case.request.threshold,
            )
            for case, prediction in zip(cases, predictions, strict=True)
        )
    )
    mean_absolute_error = sum(
        abs(prediction.expected_value - case.actual_value)
        for case, prediction in zip(cases, predictions, strict=True)
    ) / len(cases)
    return BacktestReport(
        sample_count=len(cases),
        mean_absolute_error=round(mean_absolute_error, 6),
        calibration=calibration,
        predictions=predictions,
    )
