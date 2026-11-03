/**
 * README excerpt for company repos that declare nothing (2026-11-03).
 *
 * The theme match reads name, description and topics. A repo with no description
 * is UNKNOWN, not "no match": on 2026-11-03 24 of 77 inbox repos had none, and
 * reading their READMEs found 17 useful ones the theme pass had called "no fit".
 * The company sensor calls fillReadmes after its org pass; the brief matches on
 * the excerpt when the description is blank.
 *
 * The excerpt feeds a keyword theme match only - it never reaches a model.
 */
const { fetchResponse } = require("./http");

const EXCERPT_MAX = 1500;

/** Plain words from a README: no code blocks, markup, images, badges or URLs. */
function readmeText(raw) {
  return String(raw || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EXCERPT_MAX);
}

/**
 * Read READMEs for up to `limit` waiting repos. fetchReadme(repo) returns the raw
 * text, null when GitHub says there is none, or throws. An error is stored as
 * `error` so the next run retries it; it never fails the sensor.
 */
async function fillReadmes({ store, fetchReadme, limit = 30, nowIso = new Date().toISOString() }) {
  const rows = store.needsReadme(limit);
  const out = { read: 0, none: 0, errors: 0, population: rows.length };
  for (const r of rows) {
    try {
      const raw = await fetchReadme(r.repo);
      const text = raw == null ? "" : readmeText(raw);
      if (text) {
        store.saveReadme(r.repo, "ok", text, nowIso);
        out.read += 1;
      } else {
        store.saveReadme(r.repo, "none", null, nowIso);
        out.none += 1;
      }
    } catch {
      store.saveReadme(r.repo, "error", null, nowIso);
      out.errors += 1;
    }
  }
  return out;
}

/** GitHub README as raw text; null on 404 (no README). */
function ghReadme({ token = process.env.GITHUB_TOKEN, timeoutMs = 20000 } = {}) {
  const headers = { Accept: "application/vnd.github.raw", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return async (repo) => {
    try {
      return await (await fetchResponse(`https://api.github.com/repos/${repo}/readme`, { headers, timeoutMs })).text();
    } catch (err) {
      if (err && err.status === 404) return null;
      throw err;
    }
  };
}

module.exports = { readmeText, fillReadmes, ghReadme, EXCERPT_MAX };
