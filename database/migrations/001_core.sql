BEGIN;

CREATE TABLE streams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Traffic', 'Parking', 'Queues', 'Operations', 'Footfall', 'Mobility', 'Weather')),
    status TEXT NOT NULL CHECK (status IN ('Candidate', 'Qualified', 'Suspended', 'Retired')),
    region TEXT NOT NULL,
    timezone TEXT NOT NULL,
    public_playback_id TEXT,
    authorized_at TIMESTAMPTZ,
    qualification JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE markets (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL REFERENCES streams(id),
    chain_id BIGINT NOT NULL,
    contract_address TEXT,
    question TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Scheduled', 'Open', 'Locked', 'Observing', 'Result proposed', 'Challenged', 'Resolved', 'Invalid')),
    rule_hash TEXT NOT NULL CHECK (rule_hash ~ '^0x[0-9a-fA-F]{64}$'),
    opens_at TIMESTAMPTZ NOT NULL,
    locks_at TIMESTAMPTZ NOT NULL,
    observation_starts_at TIMESTAMPTZ NOT NULL,
    observation_ends_at TIMESTAMPTZ NOT NULL,
    challenge_ends_at TIMESTAMPTZ,
    observed_value BIGINT,
    winning_outcome_id TEXT,
    evidence_root TEXT CHECK (evidence_root IS NULL OR evidence_root ~ '^0x[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (opens_at < locks_at),
    CHECK (locks_at <= observation_starts_at),
    CHECK (observation_starts_at < observation_ends_at)
);

CREATE TABLE market_outcomes (
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    outcome_id TEXT NOT NULL,
    label TEXT NOT NULL,
    minimum_value BIGINT,
    maximum_value BIGINT,
    sort_order SMALLINT NOT NULL,
    PRIMARY KEY (market_id, outcome_id),
    UNIQUE (market_id, sort_order),
    CHECK (minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value)
);

CREATE TABLE observer_reports (
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    observer_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('edge', 'primary_vision', 'verification')),
    observed_value BIGINT NOT NULL CHECK (observed_value >= 0),
    confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    model_version TEXT NOT NULL,
    uptime DOUBLE PRECISION NOT NULL CHECK (uptime BETWEEN 0 AND 1),
    maximum_timestamp_drift_ms DOUBLE PRECISION NOT NULL CHECK (maximum_timestamp_drift_ms >= 0),
    average_visibility DOUBLE PRECISION NOT NULL CHECK (average_visibility BETWEEN 0 AND 1),
    longest_frozen_seconds DOUBLE PRECISION NOT NULL CHECK (longest_frozen_seconds >= 0),
    invalid_reasons TEXT[] NOT NULL DEFAULT '{}',
    signature TEXT,
    recorded_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (market_id, observer_id)
);

CREATE TABLE evidence_records (
    record_id TEXT PRIMARY KEY CHECK (record_id ~ '^[0-9a-f]{64}$'),
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    object_key TEXT NOT NULL,
    encryption_key_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ,
    UNIQUE (market_id, name),
    CHECK (expires_at > created_at)
);

CREATE TABLE forecast_predictions (
    id BIGSERIAL PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    stream_id TEXT NOT NULL REFERENCES streams(id),
    source TEXT NOT NULL CHECK (source IN ('scry_ai', 'community', 'top_forecasters', 'market')),
    probability DOUBLE PRECISION CHECK (probability IS NULL OR probability BETWEEN 0 AND 1),
    expected_value DOUBLE PRECISION,
    lower_bound DOUBLE PRECISION,
    upper_bound DOUBLE PRECISION,
    model_version TEXT,
    feature_version TEXT,
    recorded_at TIMESTAMPTZ NOT NULL,
    UNIQUE (market_id, source, recorded_at)
);

CREATE TABLE forecast_submissions (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    forecaster_id TEXT NOT NULL,
    forecaster_kind TEXT NOT NULL CHECK (forecaster_kind IN ('Human', 'Agent')),
    outcome_id TEXT,
    probability DOUBLE PRECISION NOT NULL CHECK (probability BETWEEN 0 AND 1),
    numerical_forecast DOUBLE PRECISION,
    submitted_at TIMESTAMPTZ NOT NULL,
    UNIQUE (market_id, forecaster_id)
);

CREATE TABLE room_messages (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_kind TEXT NOT NULL CHECK (author_kind IN ('Human', 'Agent', 'System')),
    body TEXT NOT NULL CHECK (CHAR_LENGTH(body) BETWEEN 2 AND 160),
    created_at TIMESTAMPTZ NOT NULL,
    moderated_at TIMESTAMPTZ
);

CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    account TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('Market', 'Observer', 'Account')),
    market_id TEXT REFERENCES markets(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    read_at TIMESTAMPTZ
);

CREATE TABLE chain_events (
    event_id TEXT PRIMARY KEY,
    chain_id BIGINT NOT NULL,
    block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
    transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
    log_index INTEGER NOT NULL CHECK (log_index >= 0),
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    event_type TEXT NOT NULL,
    market_id TEXT,
    payload JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chain_id, transaction_hash, log_index)
);

CREATE TABLE projected_positions (
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    account TEXT NOT NULL,
    outcome_id TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL CHECK (amount >= 0),
    claimed_amount NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (claimed_amount >= 0),
    refunded_amount NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (market_id, account, outcome_id),
    FOREIGN KEY (market_id, outcome_id) REFERENCES market_outcomes(market_id, outcome_id)
);

CREATE TABLE event_outbox (
    event_id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT
);

CREATE INDEX markets_stream_status_idx ON markets (stream_id, status);
CREATE INDEX markets_timeline_idx ON markets (opens_at, observation_ends_at);
CREATE INDEX evidence_records_expiry_idx ON evidence_records (expires_at) WHERE deleted_at IS NULL;
CREATE INDEX forecast_submissions_forecaster_idx ON forecast_submissions (forecaster_id, submitted_at DESC);
CREATE INDEX room_messages_market_time_idx ON room_messages (market_id, created_at DESC);
CREATE INDEX notifications_account_time_idx ON notifications (account, created_at DESC);
CREATE INDEX chain_events_market_order_idx ON chain_events (market_id, block_number, transaction_index, log_index);
CREATE INDEX event_outbox_pending_idx ON event_outbox (occurred_at) WHERE published_at IS NULL;

COMMIT;
