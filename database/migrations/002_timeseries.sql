BEGIN;

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE count_observations (
    stream_id TEXT NOT NULL REFERENCES streams(id),
    observer_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    event_count BIGINT NOT NULL CHECK (event_count >= 0),
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds > 0),
    stream_quality DOUBLE PRECISION NOT NULL CHECK (stream_quality BETWEEN 0 AND 1),
    model_version TEXT NOT NULL,
    PRIMARY KEY (stream_id, observer_id, observed_at)
);

CREATE TABLE stream_health_samples (
    stream_id TEXT NOT NULL REFERENCES streams(id),
    source_timestamp TIMESTAMPTZ NOT NULL,
    received_timestamp TIMESTAMPTZ NOT NULL,
    visibility DOUBLE PRECISION NOT NULL CHECK (visibility BETWEEN 0 AND 1),
    frame_fingerprint TEXT NOT NULL,
    event_count BIGINT NOT NULL CHECK (event_count >= 0),
    timestamp_drift_ms DOUBLE PRECISION NOT NULL CHECK (timestamp_drift_ms >= 0),
    manipulation_suspected BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (stream_id, source_timestamp)
);

CREATE TABLE market_probability_history (
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('market', 'scry_ai', 'community', 'top_forecasters')),
    recorded_at TIMESTAMPTZ NOT NULL,
    probability DOUBLE PRECISION NOT NULL CHECK (probability BETWEEN 0 AND 1),
    sample_size INTEGER CHECK (sample_size IS NULL OR sample_size >= 0),
    PRIMARY KEY (market_id, source, recorded_at)
);

SELECT create_hypertable('count_observations', 'observed_at', if_not_exists => TRUE);
SELECT create_hypertable('stream_health_samples', 'source_timestamp', if_not_exists => TRUE);
SELECT create_hypertable('market_probability_history', 'recorded_at', if_not_exists => TRUE);

CREATE INDEX count_observations_stream_time_idx ON count_observations (stream_id, observed_at DESC);
CREATE INDEX stream_health_stream_time_idx ON stream_health_samples (stream_id, source_timestamp DESC);
CREATE INDEX market_probability_market_time_idx ON market_probability_history (market_id, recorded_at DESC);

COMMIT;
