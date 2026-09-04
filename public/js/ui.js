/**
 * UI Render Functions
 */

const UI = {
  // Current view mode (list or grid)
  viewMode: localStorage.getItem("viewMode") || "list",

  // Render stats cards
  renderStats(stats) {
    const lastDigest = stats.latestDigest || "—";
    const digestAttrs = stats.latestDigest
      ? `onclick="App.setView('digests')" style="cursor:pointer" title="Open Digests view"`
      : `title="No digests yet"`;
    return `
      <div class="stat-card">
        <div class="stat-value">${stats.totalItems || 0}</div>
        <div class="stat-label">Total Items</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.enabledSources || 0}</div>
        <div class="stat-label">Active Sources</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.bookmarkCount || 0}</div>
        <div class="stat-label">Bookmarks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${Object.keys(stats.bySource || {}).length}</div>
        <div class="stat-label">Source Types</div>
      </div>
      <div class="stat-card" ${digestAttrs}>
        <div class="stat-value" style="font-size:1.1rem;">${lastDigest}</div>
        <div class="stat-label">Last digest</div>
      </div>
    `;
  },

  // Render item card
  renderItem(item) {
    const isBookmarked = item.bookmark_id;
    const timeAgo = this.timeAgo(item.published_at);
    const metadata = item.metadata ? JSON.parse(item.metadata) : {};

    return `
      <div class="card item-card" data-id="${item.id}">
        <div class="item-header">
          <div>
            <span class="badge badge-${item.source}">${item.source}</span>
            ${metadata.version ? `<span class="badge badge-version">v${metadata.version}</span>` : ""}
            ${metadata.category ? `<span class="badge badge-category">${metadata.category}</span>` : ""}
            ${metadata.change_count ? `<span class="item-stat" title="Changes">${Icons.code} ${metadata.change_count} changes</span>` : ""}
            ${metadata.section_count ? `<span class="item-stat" title="Sections">${metadata.section_count} sections</span>` : ""}
            ${metadata.fetched_at_version ? `<span class="item-stat" title="Claude Code version at fetch">@ v${metadata.fetched_at_version}</span>` : ""}
          </div>
          <div class="item-actions">
            <button class="btn btn-icon bookmark-btn ${isBookmarked ? "active" : ""}"
                    onclick="App.toggleBookmark('${item.id}')"
                    title="${isBookmarked ? "Remove bookmark" : "Add bookmark"}">
              ${isBookmarked ? Icons.starFilled : Icons.starOutline}
            </button>
          </div>
        </div>
        <h3 class="card-title">
          <a href="${item.url}" target="_blank" rel="noopener">
            ${this.escapeHtml(item.title)}
            <span class="external-link-icon">${Icons.externalLink}</span>
          </a>
        </h3>
        ${item.description ? `<p class="card-description">${this.escapeHtml(item.description.substring(0, 200))}${item.description.length > 200 ? "..." : ""}</p>` : ""}
        <div class="item-stats">
          ${item.stars ? `<span class="item-stat" title="Stars">${Icons.star} ${this.formatNumber(item.stars)}</span>` : ""}
          ${item.score ? `<span class="item-stat" title="Relevance Score">${Icons.chart} ${Math.round(item.score)}</span>` : ""}
          ${item.author ? `<span class="item-stat" title="Author">${Icons.user} ${this.escapeHtml(item.author)}</span>` : ""}
          ${metadata.language ? `<span class="item-stat" title="Language">${Icons.code} ${metadata.language}</span>` : ""}
          ${metadata.forks ? `<span class="item-stat" title="Forks">${Icons.fork} ${this.formatNumber(metadata.forks)}</span>` : ""}
          ${metadata.downloads ? `<span class="item-stat" title="Downloads">${Icons.download} ${this.formatNumber(metadata.downloads)}</span>` : ""}
          ${metadata.likes ? `<span class="item-stat" title="Likes">${Icons.heart} ${this.formatNumber(metadata.likes)}</span>` : ""}
          ${metadata.comments ? `<span class="item-stat" title="Comments">${Icons.comment} ${metadata.comments}</span>` : ""}
          <span class="item-stat" title="Published">${Icons.clock} ${timeAgo}</span>
        </div>
        ${metadata?.matched_projects?.length ? `
          <div class="item-discovery">
            ${metadata.matched_projects.map(mp =>
              `<span class="badge" style="background:${UI.getProjectColor(mp.id)};color:#fff;font-size:0.7rem;padding:2px 6px;border-radius:3px;margin-right:4px;" title="Relevant to ${mp.name}: ${mp.overlap} shared deps">${Icons.discover || ''} ${mp.id}</span>`
            ).join('')}
          </div>
        ` : ''}
        ${metadata?.match_reason ? `<div class="item-match-reason" style="font-size:0.75rem;color:#8b949e;margin-top:4px;" title="${UI.escapeHtml(metadata.match_reason)}">${UI.escapeHtml(metadata.match_reason)}</div>` : ''}
      </div>
    `;
  },

  // Render source filter chips
  renderSourceFilters(sources, activeSources) {
    return sources
      .map((s) => {
        // Shape marker, not colour: last fetch of this source failed/timed out
        const failed = s.last_status === "error" || s.last_status === "timeout";
        const mark = failed ? `<span class="chip-fail" title="${(s.last_error || s.last_status).replace(/"/g, "&quot;")}">[!]</span> ` : "";
        return `
      <button class="chip ${activeSources.includes(s.id) ? "active" : ""} ${failed ? "chip-failed" : ""}"
              onclick="App.toggleSourceFilter('${s.id}')"
              title="${failed ? "Last fetch " + s.last_status + ": " + (s.last_error || "").replace(/"/g, "&quot;") : "Last fetch: " + (s.last_status || "never")}"
              style="${activeSources.includes(s.id) ? `border-color: ${s.color}; color: ${s.color}` : ""}">
        ${mark}${s.name}
      </button>
    `;
      })
      .join("");
  },

  // Render view toggle buttons
  renderViewToggle() {
    return `
      <div class="view-toggle">
        <button class="btn btn-icon view-btn ${this.viewMode === "list" ? "active" : ""}"
                onclick="UI.setViewMode('list')" title="List view">
          ${Icons.list}
        </button>
        <button class="btn btn-icon view-btn ${this.viewMode === "grid" ? "active" : ""}"
                onclick="UI.setViewMode('grid')" title="Grid view">
          ${Icons.grid}
        </button>
      </div>
    `;
  },

  // Set view mode
  setViewMode(mode) {
    this.viewMode = mode;
    localStorage.setItem("viewMode", mode);
    const feed = document.getElementById("feed");
    if (feed) {
      feed.className = mode === "grid" ? "feed feed-grid" : "feed";
    }
    // Update button states
    document.querySelectorAll(".view-btn").forEach((btn) => {
      btn.classList.remove("active");
    });
    const activeBtn = document.querySelector(
      `.view-btn[onclick="UI.setViewMode('${mode}')"]`,
    );
    if (activeBtn) activeBtn.classList.add("active");
  },

  // Initialize view mode on page load
  initViewMode() {
    const feed = document.getElementById("feed");
    if (feed && this.viewMode === "grid") {
      feed.className = "feed feed-grid";
    }
  },

  // Helper: Time ago
  timeAgo(dateStr) {
    if (!dateStr) return "Unknown";
    const seconds = Math.floor(
      (Date.now() - new Date(dateStr).getTime()) / 1000,
    );
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  },

  // Helper: Format number
  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toString();
  },

  // Helper: Escape HTML
  escapeHtml(str) {
    if (!str) return "";
    return str.replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );
  },

  /**
   * A stable badge colour for a project, DERIVED from its id rather than
   * looked up in a table.
   *
   * The table this replaces named five projects and silently returned grey for
   * every other one - so a portfolio of nine rendered four of them identically,
   * and the page gave no sign that it had run out of colours. Deriving means a
   * project added tomorrow gets a colour without anyone editing this file.
   *
   * The palette deliberately contains no red/green pair: the person reading
   * these badges cannot tell those two apart, so a generator free to pick any
   * hue would eventually make two projects indistinguishable to them. Eight
   * curated hues, chosen to stay apart on that axis.
   *
   * With more projects than hues two badges will share a colour. That is
   * acceptable HERE and only here: the badge prints the project id as its
   * label, so colour is decoration beside a written name rather than the
   * channel carrying the meaning.
   */
  getProjectColor(projectId) {
    const PALETTE = ['#1f6feb', '#8b5cf6', '#2dd4bf', '#d97706', '#f97316', '#db2777', '#0891b2', '#94a3b8'];
    if (!projectId) return '#6e7681';
    let h = 0;
    for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  },

  // Show toast notification
  showToast(message, type = "info", durationMs = 3000) {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
  },

  // Loading state
  showLoading(element) {
    element.innerHTML =
      '<div class="loading"><div class="spinner"></div></div>';
  },

  // Render sort dropdown
  renderSortDropdown(currentSort, currentOrder) {
    const options = [
      { value: "score", label: "Relevance" },
      { value: "date", label: "Date Published" },
      { value: "stars", label: "Stars" },
      { value: "recent", label: "Recently Added" },
    ];

    return `
      <div class="sort-controls">
        <label class="filter-label">Sort:</label>
        <select id="sort-by" class="select" onchange="App.changeSort()">
          ${options.map((o) => `<option value="${o.value}" ${currentSort === o.value ? "selected" : ""}>${o.label}</option>`).join("")}
        </select>
        <button class="btn btn-icon sort-order-btn" onclick="App.toggleSortOrder()" title="Toggle order">
          ${currentOrder === "DESC" ? Icons.sortDesc || "↓" : Icons.sortAsc || "↑"}
        </button>
      </div>
    `;
  },

  // Render advanced filters panel
  renderAdvancedFilters(state) {
    return `
      <div class="advanced-filters">
        <div class="filter-row">
          <div class="filter-item">
            <label class="filter-label">Date From</label>
            <input type="date" id="date-from" class="input" value="${state.dateFrom}" onchange="App.applyFilters()">
          </div>
          <div class="filter-item">
            <label class="filter-label">Date To</label>
            <input type="date" id="date-to" class="input" value="${state.dateTo}" onchange="App.applyFilters()">
          </div>
        </div>
        <div class="filter-row">
          <div class="filter-item">
            <label class="filter-label">Min Score</label>
            <input type="number" id="score-min" class="input" placeholder="0" value="${state.scoreMin}" onchange="App.applyFilters()">
          </div>
          <div class="filter-item">
            <label class="filter-label">Max Score</label>
            <input type="number" id="score-max" class="input" placeholder="100" value="${state.scoreMax}" onchange="App.applyFilters()">
          </div>
        </div>
        <div class="filter-row">
          <div class="filter-item">
            <label class="filter-label">Min Stars</label>
            <input type="number" id="stars-min" class="input" placeholder="e.g. 20000" value="${state.starsMin}" onchange="App.applyFilters()">
          </div>
          <div class="filter-item">
            <label class="filter-label">Max Stars</label>
            <input type="number" id="stars-max" class="input" placeholder="∞" value="${state.starsMax}" onchange="App.applyFilters()">
          </div>
        </div>
        <div class="filter-row">
          <label class="checkbox-label">
            <input type="checkbox" id="bookmarks-only" ${state.bookmarksOnly ? "checked" : ""} onchange="App.applyFilters()">
            Bookmarks only
          </label>
        </div>
      </div>
    `;
  },

  // Render search suggestions dropdown
  renderSearchSuggestions(suggestions, recentSearches) {
    if (!suggestions.length && !recentSearches.length) return "";

    let html = '<div class="search-suggestions">';

    if (suggestions.length > 0) {
      html +=
        '<div class="suggestion-group"><span class="suggestion-header">Suggestions</span>';
      for (const s of suggestions) {
        html += `<button class="suggestion-item" onclick="App.applySuggestion('${this.escapeHtml(s.query)}')">${this.escapeHtml(s.query)} <span class="suggestion-count">${s.count}</span></button>`;
      }
      html += "</div>";
    }

    if (recentSearches.length > 0 && !suggestions.length) {
      html +=
        '<div class="suggestion-group"><span class="suggestion-header">Recent</span>';
      for (const s of recentSearches.slice(0, 5)) {
        html += `<button class="suggestion-item" onclick="App.applySuggestion('${this.escapeHtml(s.query)}')">${this.escapeHtml(s.query)}</button>`;
      }
      html += "</div>";
    }

    html += "</div>";
    return html;
  },

  // Render saved searches
  renderSavedSearches(searches) {
    if (!searches.length)
      return '<div class="saved-empty">No saved searches</div>';

    return searches
      .map(
        (s) => `
        <div class="saved-search-item">
          <button class="saved-search-btn" onclick="App.loadSavedSearch(${s.id})">
            ${Icons.search} ${this.escapeHtml(s.name)}
          </button>
          <button class="btn btn-icon" onclick="App.deleteSavedSearch(${s.id})" title="Delete">×</button>
        </div>
      `,
      )
      .join("");
  },
};
