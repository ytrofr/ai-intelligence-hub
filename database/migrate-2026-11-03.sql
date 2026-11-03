-- 2026-11-03: weekly_runs records the exact window each digest covered.
-- Applied idempotently at boot by ensureColumns() in database/db.js; this file is the record.
-- Why: the digest looked back "7 days from now", so items first seen between two runs and
-- every item of a week whose run failed were never reported (audit 2026-11-03).
ALTER TABLE weekly_runs ADD COLUMN window_since TEXT;   -- ISO, inclusive
ALTER TABLE weekly_runs ADD COLUMN window_until TEXT;   -- ISO, exclusive; next run starts here
ALTER TABLE weekly_runs ADD COLUMN eligible_count INTEGER; -- items that qualified, before any display cap

-- company_repos.topics (2026-11-03, later the same day): the repo's declared GitHub topics,
-- JSON array. Applied by applyCompanySchema() in database/company-store.js when missing.
ALTER TABLE company_repos ADD COLUMN topics TEXT;
