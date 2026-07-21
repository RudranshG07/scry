BEGIN;

CREATE TABLE forecaster_reputation_snapshots (
    forecaster_id TEXT NOT NULL,
    forecaster_kind TEXT NOT NULL CHECK (forecaster_kind IN ('Human', 'Agent')),
    category TEXT NOT NULL CHECK (category IN ('Traffic', 'Parking', 'Queues', 'Operations', 'Footfall', 'Mobility', 'Weather')),
    location_scope TEXT NOT NULL,
    horizon_bucket TEXT NOT NULL CHECK (horizon_bucket IN ('short', 'medium', 'long')),
    snapshot_at TIMESTAMPTZ NOT NULL,
    rank INTEGER NOT NULL CHECK (rank > 0),
    sample_count INTEGER NOT NULL CHECK (sample_count > 0),
    brier_score DOUBLE PRECISION NOT NULL CHECK (brier_score BETWEEN 0 AND 1),
    calibration_error DOUBLE PRECISION NOT NULL CHECK (calibration_error BETWEEN 0 AND 1),
    numerical_mean_absolute_error DOUBLE PRECISION CHECK (numerical_mean_absolute_error IS NULL OR numerical_mean_absolute_error >= 0),
    composite_score DOUBLE PRECISION NOT NULL CHECK (composite_score BETWEEN 0 AND 100),
    eligible BOOLEAN NOT NULL,
    PRIMARY KEY (forecaster_id, category, location_scope, horizon_bucket, snapshot_at)
);

CREATE INDEX forecaster_reputation_scope_rank_idx ON forecaster_reputation_snapshots (category, location_scope, horizon_bucket, snapshot_at DESC, rank);

COMMIT;
