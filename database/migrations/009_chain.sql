BEGIN;

CREATE TABLE market_deployments (
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    chain_id BIGINT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('Requested', 'Created', 'Proposed', 'Finalized', 'Voided', 'Unfunded', 'Failed')),
    contract_address TEXT CHECK (contract_address IS NULL OR contract_address ~ '^0x[0-9a-fA-F]{40}$'),
    created_block BIGINT CHECK (created_block IS NULL OR created_block >= 0),
    requested_by TEXT,
    created_tx TEXT,
    proposed_tx TEXT,
    settled_tx TEXT,
    challenge_ends_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (market_id, chain_id),
    CHECK (state IN ('Requested', 'Failed') OR contract_address IS NOT NULL)
);

CREATE UNIQUE INDEX market_deployments_contract_idx ON market_deployments (chain_id, lower(contract_address)) WHERE contract_address IS NOT NULL;
CREATE INDEX market_deployments_work_idx ON market_deployments (chain_id, state, updated_at);

CREATE TABLE result_attestations (
    market_id TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    observer_id TEXT NOT NULL,
    signer TEXT NOT NULL CHECK (signer ~ '^0x[0-9a-fA-F]{40}$'),
    digest TEXT NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
    signature TEXT NOT NULL CHECK (signature ~ '^0x[0-9a-f]{130}$'),
    signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (market_id, chain_id, observer_id),
    FOREIGN KEY (market_id, chain_id) REFERENCES market_deployments(market_id, chain_id) ON DELETE CASCADE
);

ALTER TABLE projected_positions ADD COLUMN chain_id BIGINT NOT NULL DEFAULT 8453;
ALTER TABLE projected_positions ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE projected_positions DROP CONSTRAINT projected_positions_pkey;
ALTER TABLE projected_positions ADD PRIMARY KEY (market_id, chain_id, account, outcome_id);

COMMIT;
