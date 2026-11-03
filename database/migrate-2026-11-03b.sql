-- 2026-11-03: README excerpt for company repos that declare no description.
-- Applied idempotently at boot by applyCompanySchema() in database/company-store.js; this file is the record.
-- Why: the theme match reads name/description/topics only; 24 of 77 inbox repos had no
-- description, and 17 useful ones were filed as "no fit" until their READMEs were read.
ALTER TABLE company_repos ADD COLUMN readme_excerpt TEXT;  -- plain words, <= 1500 chars
ALTER TABLE company_repos ADD COLUMN readme_status TEXT;   -- NULL not read · ok · none · error (retried)
ALTER TABLE company_repos ADD COLUMN readme_read_at TEXT;  -- ISO
