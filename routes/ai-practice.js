/**
 * GET /api/ai-practice - the AI practice scorecard (project x practice item).
 *
 * Source of truth is outside this repo: ~/.claude/state/ai-practice-scorecard/latest.json,
 * written by ~/.claude/scripts/ai-practice-scorecard.py (the /ai-dna practice-scorecard
 * phase, weekly timer + every /finalize of an AI-touching plan). This route only reads
 * and reshapes it: every verdict, every piece of evidence, the population and the
 * positive control are computed by the scorecard run and never re-decided here.
 *
 * Display laws, same as capabilities.js:
 *  - A missing state file is NOT an error. It means the scorecard has never run, which
 *    is itself a finding - the page says so rather than rendering an empty table.
 *  - "unknown" is its own state: the check could not judge. It is never absent.
 *  - Counts come from the run, so the page and the report cannot disagree.
 *
 * Override the location with HUB_AI_PRACTICE_STATE.
 */

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const router = express.Router();
const STATE = process.env.HUB_AI_PRACTICE_STATE
  || path.join(os.homedir(), ".claude", "state", "ai-practice-scorecard", "latest.json");

router.get("/", (req, res) => {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.json({
        never_run: true,
        state_path: STATE,
        how: "python3 ~/.claude/scripts/ai-practice-scorecard.py",
        items: [],
        projects: [],
        counts: { cells: 0, by_state: {} },
        changed_cells: [],
        quests_to_file: [],
      });
    }
    console.warn(`[ai-practice] ${STATE} unreadable: ${err.message}`);
    return res.status(500).json({ error: `scorecard state not readable at ${STATE}` });
  }

  // The array order IS the order the script scored, so item 1 stays item 1 everywhere.
  // A project a partial run did not reach keeps whatever the previous run found, and the
  // run records that as `partial_run` - the page has to be able to say so.
  res.json({
    never_run: false,
    generated_at: raw.generated_at || null,
    date: raw.date || null,
    state_path: STATE,
    partial_run: raw.partial_run || null,
    versions_stale: raw.versions_stale || null,
    items: raw.items || [],
    state_words: raw.states || {},
    projects: Object.values(raw.projects || {}).map((p) => ({
      id: p.id,
      name: p.name,
      root: p.root,
      branch: p.branch || null,
      sha: p.sha || null,
      dirty_files: p.dirty_files ?? null,
      readable: p.readable !== false,
      cells: p.cells || {},
    })),
    counts: raw.counts || { cells: 0, by_state: {} },
    control: raw.control || null,
    harvest_crosscheck: raw.harvest_crosscheck || null,
    previous_run: raw.previous_run || null,
    changed_cells: raw.changed_cells || [],
    quests_to_file: raw.quests_to_file || [],
  });
});

module.exports = router;
