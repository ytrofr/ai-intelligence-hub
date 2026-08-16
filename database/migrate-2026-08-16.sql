-- 2026-08-16: per-source fetch truth. Applied automatically by ensureColumns() in
-- database/db.js on boot; kept here as the human-readable record of the change.
ALTER TABLE sources ADD COLUMN last_status TEXT;        -- success | error | timeout
ALTER TABLE sources ADD COLUMN last_error TEXT;         -- last failure message (<=500 chars)
ALTER TABLE sources ADD COLUMN last_item_count INTEGER; -- items upserted on the last run
ALTER TABLE sources ADD COLUMN last_run_at TEXT;        -- ISO time of the last attempt
