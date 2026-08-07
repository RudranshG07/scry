BEGIN;

ALTER TABLE markets
    ADD COLUMN claim_kind TEXT NOT NULL DEFAULT 'crossings',
    ADD COLUMN claim_target TEXT NOT NULL DEFAULT 'anything',
    ADD COLUMN claim_options JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE streams
    ADD COLUMN default_claim JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX markets_claim_idx ON markets (claim_kind, claim_target);

COMMIT;
