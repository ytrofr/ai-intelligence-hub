/**
 * GET /api/dna-map - the DNA map (shared AI knowledge x project).
 *
 * Reads the producer's latest JSON on every request; the shaping lives in
 * modules/dna-map.js. A missing or unparsable file is not an error - it returns
 * an honest empty state the page renders as-is. Never fabricated rows.
 * Override the location with HUB_DNA_MAP_STATE.
 */

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildDnaMap } = require("../modules/dna-map");

const router = express.Router();
const STATE = process.env.HUB_DNA_MAP_STATE
  || path.join(os.homedir(), ".claude", "state", "dna-map", "latest.json");

router.get("/", (req, res) => {
  let map = null;
  let reason = null;
  try {
    map = JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch (err) {
    reason = err.code === "ENOENT" ? "the map file does not exist yet" : `the map file is unreadable: ${err.message}`;
    if (err.code !== "ENOENT") console.warn(`[dna-map] ${STATE} unreadable: ${err.message}`);
  }
  res.json(buildDnaMap(map, { reason }));
});

module.exports = router;
