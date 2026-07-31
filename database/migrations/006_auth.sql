BEGIN;

CREATE TABLE auth_nonces (
    nonce TEXT PRIMARY KEY,
    address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CHECK (expires_at > issued_at)
);

CREATE INDEX auth_nonces_expiry_idx ON auth_nonces (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE sessions (
    token_digest TEXT PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
    address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);

CREATE INDEX sessions_address_idx ON sessions (address) WHERE revoked_at IS NULL;

COMMIT;
