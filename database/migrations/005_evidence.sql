BEGIN;

ALTER TABLE observer_reports
    ADD COLUMN evidence_root TEXT
    CHECK (evidence_root IS NULL OR evidence_root ~ '^0x[0-9a-f]{64}$');

CREATE TABLE observation_samples (
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    observer_id TEXT NOT NULL,
    leaf_index INTEGER NOT NULL CHECK (leaf_index >= 0),
    observed_at TIMESTAMPTZ NOT NULL,
    event_count BIGINT NOT NULL CHECK (event_count >= 0),
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds > 0),
    stream_quality DOUBLE PRECISION NOT NULL CHECK (stream_quality BETWEEN 0 AND 1),
    model_version TEXT NOT NULL,
    frame_digest TEXT NOT NULL CHECK (frame_digest ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (market_id, observer_id, leaf_index),
    FOREIGN KEY (market_id, observer_id)
        REFERENCES observer_reports (market_id, observer_id) ON DELETE CASCADE
);

CREATE INDEX observation_samples_market_idx ON observation_samples (market_id, observed_at);

COMMIT;
