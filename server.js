/**
 * AI Intelligence Hub - Server Entry Point
 * Port: 4444 (isolated)
 * Modular architecture with 100% FREE APIs
 */

const express = require("express");
const path = require("path");
const fs = require("fs");

// Load .env file if present (for GITHUB_TOKEN etc.)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const db = require("./database/db");

const app = express();
const PORT = 4444;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Load routes
app.use("/api/items", require("./routes/items"));
app.use("/api/fetch", require("./routes/fetch"));
app.use("/api/sources", require("./routes/sources"));
app.use("/api/bookmarks", require("./routes/bookmarks"));
app.use("/api/stats", require("./routes/stats"));
app.use("/api/search", require("./routes/search"));
app.use("/api/recommendations", require("./routes/recommendations"));
app.use("/api/digest", require("./routes/digest"));
app.use("/api/radar", require("./routes/radar"));
app.use("/api/tracked", require("./routes/tracked"));
app.use("/api/inventory", require("./routes/inventory"));
app.use("/api/maintenance", require("./routes/maintenance"));
// Back-compat alias: the old Apollo-only endpoint, forced to project=apollo
app.use("/api/hermes-radar", (req, _res, next) => { req.forcedProject = "apollo"; next(); }, require("./routes/radar"));

// Health endpoint
app.get("/api/health", (req, res) => {
  const stats = db.getStats();
  const src = db.getSourceStatusSummary();
  res.json({
    status: src.sources_failed_last_run > 0 ? "degraded" : "healthy",
    port: PORT,
    totalItems: stats.totalItems,
    bookmarks: stats.bookmarkCount,
    uptime: process.uptime(),
    sources_total: src.sources_total,
    sources_failed_last_run: src.sources_failed_last_run || 0,
    all_failed_last_run:
      src.sources_total > 0 && src.sources_failed_last_run === src.sources_total,
    failed_sources: src.failed_sources,
    last_fetch_at: src.last_fetch_at,
  });
});

// Initialize sources and keywords from config files
function initializeConfig() {
  const sourcesPath = path.join(__dirname, "config", "sources.json");
  const keywordsPath = path.join(__dirname, "config", "keywords.json");

  try {
    // Load sources
    if (fs.existsSync(sourcesPath)) {
      const { sources } = JSON.parse(fs.readFileSync(sourcesPath, "utf-8"));
      for (const source of sources) {
        db.upsertSource(source);
      }
      console.log(`✓ Loaded ${sources.length} sources`);
    }

    // Load keywords
    if (fs.existsSync(keywordsPath)) {
      const { categories } = JSON.parse(fs.readFileSync(keywordsPath, "utf-8"));
      const keywords = [];
      for (const cat of categories) {
        for (const kw of cat.keywords) {
          keywords.push({
            category: cat.id,
            keyword: kw,
            weight: cat.weight,
          });
        }
      }
      db.upsertKeywords(keywords);
      console.log(`✓ Loaded ${keywords.length} keywords`);
    }
  } catch (err) {
    console.error("Config initialization error:", err.message);
  }
}

// Start server
app.listen(PORT, () => {
  initializeConfig();
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║            AI Intelligence Hub                                ║
║            http://localhost:${PORT}                              ║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    GET  /api/items      - List items (advanced filters)       ║
║    POST /api/fetch      - Fetch from sources                  ║
║    GET  /api/sources    - List sources                        ║
║    GET  /api/bookmarks  - List bookmarks                      ║
║    GET  /api/stats      - Dashboard stats                     ║
║    GET  /api/search/*   - Search suggestions & saved          ║
║    GET  /api/recommendations - Project recommendations        ║
║    GET  /api/health     - Health check                        ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  db.close();
  process.exit(0);
});
