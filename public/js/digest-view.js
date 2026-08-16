/**
 * DigestView — renders the weekly digest in-SPA.
 *
 * Mounts into <section id="digest-view">. Reuses UI helpers for item cards,
 * timeAgo, formatNumber, escapeHtml, getProjectColor.
 *
 * Public API:
 *   DigestView.init()            — bind the section + event handlers (idempotent)
 *   DigestView.load(date?)       — fetch list, pick latest if no date, render
 *   DigestView.render(payload)   — render a parsed digest payload
 */

const DigestView = {
  initialized: false,
  currentDate: null,
  availableDates: [],

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    await this.load();
  },

  async load(date) {
    const section = document.getElementById("digest-view");
    if (!section) {
      console.warn("[digest] no #digest-view section in DOM");
      return;
    }
    section.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    let listResp;
    try {
      listResp = await API.getDigestList();
    } catch (err) {
      this._renderError(section, `Could not load digest list: ${err.message}`);
      return;
    }

    const files = listResp.digests || [];
    this.availableDates = files.map((f) =>
      f.replace("weekly-", "").replace(".md", "")
    );

    if (this.availableDates.length === 0) {
      this._renderEmpty(section);
      return;
    }

    const requested = date || this._dateFromUrl() || this.availableDates[0];
    const pick = this.availableDates.includes(requested)
      ? requested
      : this.availableDates[0];
    this.currentDate = pick;

    let payload;
    try {
      payload = await API.getDigestJson(pick);
    } catch (err) {
      this._renderError(section, `Could not load digest ${pick}: ${err.message}`);
      return;
    }

    this.render(payload);
  },

  render(payload) {
    const section = document.getElementById("digest-view");
    if (!section) return;

    const { runDate, totals, buckets, rising } = payload;
    const categoryOrder = [
      "claude-code",
      "mcp",
      "adk",
      "agent-fw",
      "video-ai",
      "rag",
      "eval",
      "other",
    ];

    const html = `
      <div class="digest-header">
        <div class="digest-header-row">
          <h2 class="digest-title">Weekly Digest · ${UI.escapeHtml(runDate)}</h2>
          ${this._renderDateSelector()}
          <span class="digest-spacer"></span>
          <button id="digest-generate-btn" class="btn btn-primary" onclick="DigestView.onGenerateClick()">
            ${Icons.refresh || "⟳"} Generate now
          </button>
        </div>
        <div class="digest-summary">
          ${totals.totalItems} items · ${
            Object.values(totals.perCategory).filter((n) => n > 0).length
          } categories · ${totals.risingCount} rising stars · last 7 days
        </div>
        <div id="digest-progress" class="digest-progress" hidden></div>
      </div>

      ${this._renderTLDR(buckets)}

      ${
        rising.length
          ? `<section class="digest-section">
               <h3 class="digest-section-title">Rising Stars (${rising.length})</h3>
               <div class="feed feed-grid">
                 ${rising.map((it) => UI.renderItem(it)).join("")}
               </div>
             </section>`
          : ""
      }

      ${categoryOrder
        .filter((id) => buckets[id] && buckets[id].items.length > 0)
        .map((id) => this._renderCategory(buckets[id]))
        .join("")}
    `;

    section.innerHTML = html;
  },

  _renderTLDR(buckets) {
    const all = Object.values(buckets).flatMap((b) => b.items);
    const top = all.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    if (top.length === 0) return "";
    return `
      <section class="digest-section digest-tldr">
        <h3 class="digest-section-title">TL;DR · Top 5</h3>
        <div class="feed feed-grid">
          ${top.map((it) => UI.renderItem(it)).join("")}
        </div>
      </section>
    `;
  },

  _renderCategory(bucket) {
    const label = UI.escapeHtml(bucket.cat.label || bucket.cat.id);
    return `
      <section class="digest-section">
        <h3 class="digest-section-title">${label} (${bucket.items.length})</h3>
        <div class="feed feed-grid">
          ${bucket.items.map((it) => UI.renderItem(it)).join("")}
        </div>
      </section>
    `;
  },

  _renderDateSelector() {
    if (this.availableDates.length <= 1) return "";
    const opts = this.availableDates
      .map(
        (d) =>
          `<option value="${UI.escapeHtml(d)}"${
            d === this.currentDate ? " selected" : ""
          }>${UI.escapeHtml(d)}</option>`
      )
      .join("");
    return `
      <select class="select digest-date-select" onchange="DigestView.onDateChange(this.value)">
        ${opts}
      </select>
    `;
  },

  _renderEmpty(section) {
    section.innerHTML = `
      <div class="digest-empty">
        <h2>No digests yet</h2>
        <p>Generate the first weekly digest to see it here.</p>
        <button class="btn btn-primary" onclick="DigestView.onGenerateClick()">
          ${Icons.refresh || "⟳"} Generate now
        </button>
        <div id="digest-progress" class="digest-progress" hidden></div>
      </div>
    `;
  },

  _renderError(section, msg) {
    section.innerHTML = `
      <div class="digest-error">
        <strong>Could not load digest</strong>
        <p>${UI.escapeHtml(msg)}</p>
        <button class="btn btn-secondary" onclick="DigestView.load()">Retry</button>
      </div>
    `;
  },

  _dateFromUrl() {
    const params = new URLSearchParams(location.search);
    return params.get("date");
  },

  onDateChange(date) {
    this.currentDate = date;
    if (typeof Filters !== "undefined" && Filters.state) {
      Filters.state.date = date;
      Filters.updateUrl();
    }
    this.load(date);
  },

  async onGenerateClick() {
    const btn = document.getElementById("digest-generate-btn");
    const progress = document.getElementById("digest-progress");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating…";
    }
    if (progress) {
      progress.hidden = false;
      progress.textContent =
        "Running channels — may take up to 15 minutes. Don't close this tab.";
    }
    try {
      const result = await API.runDigestGeneration({});
      if (progress) {
        progress.textContent = `Done · ${result.item_count} items in ${(
          result.runtime_ms / 1000
        ).toFixed(1)}s`;
      }
      if (typeof UI !== "undefined" && UI.showToast) {
        UI.showToast(`Digest generated: ${result.item_count} items`, "success");
      }
      // Re-load to show fresh data
      await this.load();
    } catch (err) {
      if (progress) {
        progress.textContent = `Failed: ${err.message}`;
      }
      if (typeof UI !== "undefined" && UI.showToast) {
        UI.showToast(`Generation failed: ${err.message}`, "error");
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Try again";
      }
    }
  },
};
