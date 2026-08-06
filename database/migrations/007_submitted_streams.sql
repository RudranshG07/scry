BEGIN;

ALTER TABLE streams
    ADD COLUMN source_url TEXT,
    ADD COLUMN submitted_by TEXT,
    ADD COLUMN submitted_at TIMESTAMPTZ;

CREATE INDEX streams_inspection_idx
    ON streams ((qualification->>'inspectedAt'))
    WHERE coalesce(btrim(source_url), '') <> '';

COMMIT;
