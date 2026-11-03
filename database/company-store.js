/**
 * Company store - every repo a tracked company creates, and the INBOX of the ones
 * that matter (2026-11-03).
 *
 * company_repos holds every repo the company-orgs source saw inside its window,
 * whatever its stars: below-floor rows are what make recall measurable later.
 * A repo enters the inbox the first time its stars pass its tier's floor
 * (floor_crossed_at, stamped once), and STAYS there until someone rules on it.
 * Nothing ages out: an unruled item from three weeks ago is still waiting, which
 * is the property the old feed+digest design lacked.
 *
 * The schema is applied to a handle passed in, so tests drive `:memory:`.
 */

const STATES = ["new", "test", "watch", "adopted", "skip", "noise"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS company_repos (
  repo             TEXT PRIMARY KEY,
  org              TEXT NOT NULL,
  company          TEXT NOT NULL,
  tier             INTEGER NOT NULL,
  created_at       TEXT,
  description      TEXT,
  language         TEXT,
  topics           TEXT,             -- JSON array of the repo's declared GitHub topics
  stars            INTEGER,
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  floor_crossed_at TEXT,             -- first time stars >= tier floor; NULL = below floor
  baseline         INTEGER NOT NULL DEFAULT 0, -- 1 = found on the org's first-ever read
  state            TEXT NOT NULL DEFAULT 'new',
  ruled_at         TEXT,
  note             TEXT
);
CREATE INDEX IF NOT EXISTS idx_company_repos_inbox ON company_repos(state, floor_crossed_at);

CREATE TABLE IF NOT EXISTS company_orgs (
  org             TEXT PRIMARY KEY,
  company         TEXT NOT NULL,
  first_read_at   TEXT,
  last_checked_at TEXT,
  last_status     TEXT,
  last_error      TEXT,
  repos_listed    INTEGER
);
`;

function applyCompanySchema(db) {
  db.exec(SCHEMA);
  // Additive columns for tables created before the column existed (record: migrate-2026-11-03.sql).
  const have = new Set(db.prepare("PRAGMA table_info(company_repos)").all().map((c) => c.name));
  if (!have.has("topics")) db.exec("ALTER TABLE company_repos ADD COLUMN topics TEXT");
  // README excerpt for repos that declare no description (record: migrate-2026-11-03b.sql).
  // readme_status: NULL = not read · ok · none (GitHub has no README) · error (retried next run)
  if (!have.has("readme_excerpt")) db.exec("ALTER TABLE company_repos ADD COLUMN readme_excerpt TEXT");
  if (!have.has("readme_status")) db.exec("ALTER TABLE company_repos ADD COLUMN readme_status TEXT");
  if (!have.has("readme_read_at")) db.exec("ALTER TABLE company_repos ADD COLUMN readme_read_at TEXT");
}

class CompanyStore {
  constructor(db) {
    this.db = db;
    this.stmts = {
      upsert: db.prepare(`
        INSERT INTO company_repos (repo, org, company, tier, created_at, description, language, topics, stars,
                                   first_seen_at, last_seen_at, floor_crossed_at, baseline)
        VALUES (@repo, @org, @company, @tier, @created_at, @description, @language, @topics, @stars,
                @now, @now, CASE WHEN @stars >= @floor THEN @now END, @baseline)
        ON CONFLICT(repo) DO UPDATE SET
          stars = excluded.stars,
          description = excluded.description,
          language = excluded.language,
          topics = excluded.topics,
          last_seen_at = @now,
          floor_crossed_at = COALESCE(company_repos.floor_crossed_at, CASE WHEN @stars >= @floor THEN @now END)
      `),
      get: db.prepare(`SELECT * FROM company_repos WHERE repo = ?`),
      count: db.prepare(`SELECT count(*) AS n FROM company_repos`),
      inbox: db.prepare(`
        SELECT * FROM company_repos WHERE state = 'new' AND floor_crossed_at IS NOT NULL
        ORDER BY floor_crossed_at, stars DESC`),
      crossedSince: db.prepare(`
        SELECT * FROM company_repos WHERE floor_crossed_at >= ? ORDER BY company, floor_crossed_at, repo`),
      rule: db.prepare(`UPDATE company_repos SET state = @state, note = @note, ruled_at = @at WHERE repo = @repo`),
      orgGet: db.prepare(`SELECT * FROM company_orgs WHERE org = ?`),
      orgSave: db.prepare(`
        INSERT INTO company_orgs (org, company, first_read_at, last_checked_at, last_status, last_error, repos_listed)
        VALUES (@org, @company, CASE WHEN @status = 'ok' THEN @at END, @at, @status, @error, @listed)
        ON CONFLICT(org) DO UPDATE SET
          company = excluded.company,
          first_read_at = COALESCE(company_orgs.first_read_at, CASE WHEN @status = 'ok' THEN @at END),
          last_checked_at = @at, last_status = @status, last_error = @error,
          repos_listed = COALESCE(@listed, company_orgs.repos_listed)
      `),
      orgs: db.prepare(`SELECT * FROM company_orgs ORDER BY company, org`),
      names: db.prepare(`SELECT repo FROM company_repos`).pluck(),
      needsReadme: db.prepare(`
        SELECT * FROM company_repos
        WHERE state = 'new' AND floor_crossed_at IS NOT NULL
          AND (description IS NULL OR trim(description) = '')
          AND (readme_status IS NULL OR readme_status = 'error')
        ORDER BY floor_crossed_at, stars DESC LIMIT ?`),
      saveReadme: db.prepare(`
        UPDATE company_repos SET readme_status = @status, readme_read_at = @at,
          readme_excerpt = COALESCE(@excerpt, readme_excerpt)
        WHERE repo = @repo`),
    };
  }

  /** Unruled inbox repos with no description whose README was never read (or failed). */
  needsReadme(limit) {
    return this.stmts.needsReadme.all(limit);
  }

  saveReadme(repo, status, excerpt, atIso) {
    this.stmts.saveReadme.run({ repo, status, excerpt: excerpt || null, at: atIso });
  }

  /** @param {{org,company,tier,floor,repo:object,baseline:boolean}} r  GitHub repo object in r.repo */
  upsert({ org, company, tier, floor, repo, baseline }, nowIso) {
    this.stmts.upsert.run({
      repo: repo.full_name,
      org,
      company,
      tier,
      floor,
      created_at: repo.created_at || null,
      description: repo.description || null,
      language: repo.language || null,
      topics: JSON.stringify(Array.isArray(repo.topics) ? repo.topics : []),
      stars: Number(repo.stargazers_count) || 0,
      now: nowIso,
      baseline: baseline ? 1 : 0,
    });
  }

  get(repo) {
    return this.stmts.get.get(repo) || null;
  }

  count() {
    return this.stmts.count.get().n;
  }

  /** Everything waiting for a ruling, oldest first. */
  inbox() {
    return this.stmts.inbox.all();
  }

  /** Repos that entered the inbox at or after `sinceIso` (any state - a ruled one still happened). */
  crossedSince(sinceIso) {
    return this.stmts.crossedSince.all(sinceIso);
  }

  rule(repo, state, note = null, atIso = new Date().toISOString()) {
    if (!STATES.includes(state)) throw new Error(`state must be one of ${STATES.join("|")}, got ${state}`);
    const r = this.stmts.rule.run({ repo, state, note, at: atIso });
    if (r.changes !== 1) throw new Error(`${repo} is not in the company inbox`);
  }

  org(org) {
    return this.stmts.orgGet.get(org) || null;
  }

  saveOrg({ org, company, status, error = null, listed = null }, atIso) {
    this.stmts.orgSave.run({ org, company, status, error, listed, at: atIso });
  }

  orgs() {
    return this.stmts.orgs.all();
  }

  /** Every repo ever recorded, whatever its stars or state - the recall check's "found" set. */
  allRepoNames() {
    return this.stmts.names.all();
  }
}

module.exports = { applyCompanySchema, CompanyStore, STATES };
