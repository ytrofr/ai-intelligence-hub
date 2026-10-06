/**
 * GET /api/capabilities - the trust matrix (project x capability).
 *
 * Reads the registry and the probe runner's latest state from ~/.claude on every
 * request; the join lives in modules/capabilities.js. A missing or unreadable
 * state file is not an error - every cell renders "unprobed".
 * Override the locations with HUB_CAPABILITIES_DIR / HUB_CAPABILITIES_STATE.
 */

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildTrust } = require("../modules/capabilities");

const router = express.Router();
const CAP_DIR = process.env.HUB_CAPABILITIES_DIR || path.join(os.homedir(), ".claude", "capabilities");
const STATE = process.env.HUB_CAPABILITIES_STATE
  || path.join(os.homedir(), ".claude", "state", "capabilities", "latest.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[capabilities] ${file} unreadable: ${err.message}`);
    return null;
  }
}

router.get("/", (req, res) => {
  const registry = readJson(path.join(CAP_DIR, "registry.json"));
  if (!registry) return res.status(500).json({ error: `registry not readable at ${CAP_DIR}` });
  res.json(buildTrust({ registry, state: readJson(STATE) }));
});

module.exports = router;
