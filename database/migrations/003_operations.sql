BEGIN;

CREATE TABLE indexer_checkpoints (
    consumer_id TEXT PRIMARY KEY,
    chain_id BIGINT NOT NULL,
    block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
    transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
    log_index INTEGER NOT NULL CHECK (log_index >= 0),
    block_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE operational_alerts (
    fingerprint TEXT PRIMARY KEY CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    code TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
    resource_id TEXT NOT NULL,
    message TEXT NOT NULL,
    measured_value DOUBLE PRECISION,
    threshold_value DOUBLE PRECISION,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
);

CREATE TABLE alert_deliveries (
    fingerprint TEXT NOT NULL REFERENCES operational_alerts(fingerprint) ON DELETE CASCADE,
    destination TEXT NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    error TEXT,
    PRIMARY KEY (fingerprint, destination, attempted_at)
);

CREATE INDEX operational_alerts_open_idx ON operational_alerts (severity, last_seen_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX alert_deliveries_pending_idx ON alert_deliveries (attempted_at) WHERE delivered_at IS NULL;

COMMIT;
