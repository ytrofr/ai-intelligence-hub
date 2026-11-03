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
}

class CompanyStore {
  constructor(db) {
    this.db = db;
    this.stmts = {
      upsert: db.prepare(`
        INSERT INTO company_repos (repo, org, company, tier, created_at, description, language, stars,
                                   first_seen_at, last_seen_at, floor_crossed_at, baseline)
        VALUES (@repo, @org, @company, @tier, @created_at, @description, @language, @stars,
                @now, @now, CASE WHEN @stars >= @floor THEN @now END, @baseline)
        ON CONFLICT(repo) DO UPDATE SET
          stars = excluded.stars,
          description = excluded.description,
          language = excluded.language,
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
    };
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
}

module.exports = { applyCompanySchema, CompanyStore, STATES };
