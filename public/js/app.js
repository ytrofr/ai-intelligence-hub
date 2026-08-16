/**
 * Main Application - Controller with Advanced Search
 */

const App = {
  sources: [],
  items: [],
  stats: {},
  savedSearches: [],
  fetching: false,
  showAdvancedFilters: false,
  suggestionsTimeout: null,

  async init() {
    Filters.init();
    await this.loadSources();
    await this.loadStats();

    // View-aware initial load: digests view skips items fetch (digest-view.js
    // handles its own loading) to avoid duplicate work + race conditions.
    if (Filters.state.view === "digests") {
      this._showDigestView();
      if (typeof DigestView !== "undefined") await DigestView.init();
    } else {
      this._showItemsView();
      await this.loadItems();
    }

    await this.loadSavedSearches();
    this.renderSortControls();
    this.renderAdvancedFiltersPanel();
    this.renderSectionToggle();
    this.bindEvents();

    // Sync UI with filter state
    document.getElementById("search-input").value = Filters.state.search;
  },

  // ── View switching ──────────────────────────────────────────────────────
  async setView(view) {
    if (view !== "items" && view !== "digests") return;
    if (Filters.state.view === view) return;
    Filters.state.view = view;
    Filters.updateUrl();
    this.renderSectionToggle();

    if (view === "digests") {
      this._showDigestView();
      if (typeof DigestView !== "undefined") await DigestView.init();
    } else {
      this._showItemsView();
      if (this.items.length === 0) await this.loadItems();
    }
  },

  _showItemsView() {
    const feed = document.getElementById("feed");
    const dv = document.getElementById("digest-view");
    const searchPanel = document.querySelector(".search-panel");
    if (feed) feed.hidden = false;
    if (dv) dv.hidden = true;
    if (searchPanel) searchPanel.hidden = false;
  },

  _showDigestView() {
    const feed = document.getElementById("feed");
    const dv = document.getElementById("digest-view");
    const searchPanel = document.querySelector(".search-panel");
    if (feed) feed.hidden = true;
    if (dv) dv.hidden = false;
    // Hide items-only search/filter panel in digest view to keep header clean
    if (searchPanel) searchPanel.hidden = true;
  },

  renderSectionToggle() {
    const slot = document.getElementById("section-toggle");
    if (!slot) return;
    const view = Filters.state.view || "items";
    slot.innerHTML = `
      <div class="section-toggle">
        <button class="btn ${
          view === "items" ? "btn-primary" : "btn-secondary"
        }" onclick="App.setView('items')">Items</button>
        <button class="btn ${
          view === "digests" ? "btn-primary" : "btn-secondary"
        }" onclick="App.setView('digests')">Digests</button>
      </div>
    `;
  },

  async loadSources() {
    try {
      const data = await API.getSources();
      this.sources = data.sources || [];
      this.renderSourceFilters();
    } catch (err) {
      console.error("Failed to load sources:", err);
    }
  },

  async loadStats() {
    try {
      this.stats = await API.getStats();
      this.stats.enabledSources = this.sources.filter((s) => s.enabled).length;

      // Best-effort: latest digest date for 5th stat card. Failure is silent.
      try {
        const list = await API.getDigestList();
        if (list && list.digests && list.digests.length > 0) {
          this.stats.latestDigest = list.digests[0]
            .replace("weekly-", "")
            .replace(".md", "");
        }
      } catch (_e) {
        /* no digest yet — card shows "—" */
      }

      document.getElementById("stats-grid").innerHTML = UI.renderStats(
        this.stats,
      );
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  },

  async loadItems() {
    const feed = document.getElementById("feed");
    UI.showLoading(feed);

    try {
      const data = await API.getItems(Filters.getParams());
      this.items = data.items || [];
      this.renderItems();
    } catch (err) {
      console.error("Failed to load items:", err);
      feed.innerHTML = '<div class="feed-empty">Failed to load items</div>';
    }
  },

  async loadSavedSearches() {
    try {
      const data = await API.getSavedSearches();
      this.savedSearches = data.searches || [];
    } catch (err) {
      console.error("Failed to load saved searches:", err);
    }
  },

  renderItems() {
    const feed = document.getElementById("feed");
    // Apply view mode
    feed.className = UI.viewMode === "grid" ? "feed feed-grid" : "feed";

    if (this.items.length === 0) {
      feed.innerHTML = `
        <div class="feed-empty">
          <p>No items found. Try adjusting filters or click "Fetch Now" to pull from sources.</p>
        </div>
      `;
      return;
    }
    feed.innerHTML = this.items.map((item) => UI.renderItem(item)).join("");
  },

  renderSourceFilters() {
    const container = document.getElementById("source-filters");
    container.innerHTML = UI.renderSourceFilters(
      this.sources.filter((s) => s.enabled),
      Filters.state.sources,
    );
  },

  renderSortControls() {
    const container = document.getElementById("sort-controls");
    container.innerHTML = UI.renderSortDropdown(
      Filters.state.sortBy,
      Filters.state.sortOrder,
    );
  },

  renderAdvancedFiltersPanel() {
    const container = document.getElementById("advanced-filters");
    container.innerHTML = UI.renderAdvancedFilters(Filters.state);
  },

  async fetchSources() {
    if (this.fetching) return;
    this.fetching = true;

    const btn = document.getElementById("fetch-btn");
    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = `${Icons.refresh} Fetching...`;

    try {
      const result = await API.fetchSources();
      const failed = (result.errors || []).map((e) => e.source);
      if (result.all_failed) {
        UI.showToast(`Fetch failed for ALL ${result.sources_attempted} sources (network down?)`, "error", 8000);
      } else if (failed.length) {
        UI.showToast(`Fetched ${result.fetched} items - ${failed.length} source(s) FAILED: ${failed.join(", ")}`, "error", 8000);
      } else {
        UI.showToast(`Fetched ${result.fetched} items from ${result.sources_attempted} sources`, "success");
      }
      await this.loadStats();
      await this.loadSources();
      await this.loadItems();
    } catch (err) {
      const msg = err && err.name === "TimeoutError" ? "still running after 5 min - check /api/health later" : err.message;
      UI.showToast("Fetch failed: " + msg, "error", 8000);
    } finally {
      this.fetching = false;
      btn.disabled = false;
      btn.innerHTML = originalContent;
    }
  },

  toggleSourceFilter(sourceId) {
    Filters.toggleSource(sourceId);
    this.renderSourceFilters();
    this.loadItems();
  },

  toggleAdvancedFilters() {
    this.showAdvancedFilters = !this.showAdvancedFilters;
    const panel = document.getElementById("advanced-filters");
    panel.classList.toggle("hidden", !this.showAdvancedFilters);
  },

  applyFilters() {
    // Read values from advanced filter inputs
    const dateFrom = document.getElementById("date-from")?.value || "";
    const dateTo = document.getElementById("date-to")?.value || "";
    const scoreMin = document.getElementById("score-min")?.value || "";
    const scoreMax = document.getElementById("score-max")?.value || "";
    const starsMin = document.getElementById("stars-min")?.value || "";
    const starsMax = document.getElementById("stars-max")?.value || "";
    const bookmarksOnly =
      document.getElementById("bookmarks-only")?.checked || false;

    Filters.setDateRange(dateFrom, dateTo);
    Filters.setScoreRange(scoreMin, scoreMax);
    Filters.setStarsRange(starsMin, starsMax);
    Filters.setBookmarksOnly(bookmarksOnly);
    this.loadItems();
  },

  changeSort() {
    const sortBy = document.getElementById("sort-by")?.value || "score";
    Filters.setSort(sortBy, Filters.state.sortOrder);
    this.loadItems();
  },

  toggleSortOrder() {
    const newOrder = Filters.state.sortOrder === "DESC" ? "ASC" : "DESC";
    Filters.setSort(Filters.state.sortBy, newOrder);
    this.renderSortControls();
    this.loadItems();
  },

  async toggleBookmark(itemId) {
    try {
      const item = this.items.find((i) => i.id === itemId);
      if (!item) return;

      if (item.bookmark_id) {
        await API.removeBookmark(itemId);
        item.bookmark_id = null;
        UI.showToast("Bookmark removed", "info");
      } else {
        await API.addBookmark(itemId);
        item.bookmark_id = "temp";
        UI.showToast("Bookmark added", "success");
      }

      this.renderItems();
      this.loadStats();
    } catch (err) {
      UI.showToast("Failed to update bookmark", "error");
    }
  },

  // Search suggestions
  async showSuggestions(query) {
    const dropdown = document.getElementById("suggestions-dropdown");
    if (!query || query.length < 2) {
      dropdown.innerHTML = "";
      return;
    }

    try {
      const [suggestionsData, recentData] = await Promise.all([
        API.getSearchSuggestions(query),
        API.getRecentSearches(),
      ]);

      dropdown.innerHTML = UI.renderSearchSuggestions(
        suggestionsData.suggestions || [],
        recentData.searches || [],
      );
    } catch (err) {
      console.error("Failed to load suggestions:", err);
    }
  },

  hideSuggestions() {
    setTimeout(() => {
      document.getElementById("suggestions-dropdown").innerHTML = "";
    }, 200);
  },

  applySuggestion(query) {
    document.getElementById("search-input").value = query;
    Filters.setSearch(query);
    this.hideSuggestions();
    this.loadItems();
  },

  // Saved searches
  toggleSavedSearches() {
    const panel = document.getElementById("saved-searches-panel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      this.renderSavedSearchesList();
    }
  },

  renderSavedSearchesList() {
    const container = document.getElementById("saved-searches-list");
    container.innerHTML = UI.renderSavedSearches(this.savedSearches);
  },

  saveCurrentSearch() {
    if (!Filters.hasActiveFilters() && !Filters.state.search) {
      UI.showToast("Nothing to save - add filters or search first", "info");
      return;
    }
    document.getElementById("save-modal").classList.remove("hidden");
    document.getElementById("save-search-name").focus();
  },

  closeSaveModal() {
    document.getElementById("save-modal").classList.add("hidden");
    document.getElementById("save-search-name").value = "";
  },

  async confirmSaveSearch() {
    const name = document.getElementById("save-search-name").value.trim();
    if (!name) {
      UI.showToast("Please enter a name", "error");
      return;
    }

    try {
      await API.saveSearch(
        name,
        Filters.state.search,
        Filters.getFilterState(),
        Filters.state.sortBy,
      );
      UI.showToast("Search saved!", "success");
      this.closeSaveModal();
      await this.loadSavedSearches();
    } catch (err) {
      UI.showToast("Failed to save search", "error");
    }
  },

  async loadSavedSearch(id) {
    const saved = this.savedSearches.find((s) => s.id === id);
    if (!saved) return;

    Filters.loadSavedSearch(saved);

    // Update UI
    document.getElementById("search-input").value = Filters.state.search;
    this.renderSourceFilters();
    this.renderAdvancedFiltersPanel();
    this.renderSortControls();
    this.toggleSavedSearches();
    await this.loadItems();

    UI.showToast(`Loaded: ${saved.name}`, "info");
  },

  async deleteSavedSearch(id) {
    try {
      await API.deleteSavedSearch(id);
      UI.showToast("Search deleted", "info");
      await this.loadSavedSearches();
      this.renderSavedSearchesList();
    } catch (err) {
      UI.showToast("Failed to delete search", "error");
    }
  },

  bindEvents() {
    // Fetch button
    document
      .getElementById("fetch-btn")
      .addEventListener("click", () => this.fetchSources());

    // Search input
    const searchInput = document.getElementById("search-input");

    let debounce;
    searchInput.addEventListener("input", (e) => {
      clearTimeout(debounce);
      clearTimeout(this.suggestionsTimeout);

      debounce = setTimeout(() => {
        Filters.setSearch(e.target.value);
        this.loadItems();
      }, 300);

      // Show suggestions
      this.suggestionsTimeout = setTimeout(() => {
        this.showSuggestions(e.target.value);
      }, 150);
    });

    searchInput.addEventListener("focus", () => {
      if (searchInput.value.length >= 2) {
        this.showSuggestions(searchInput.value);
      }
    });

    searchInput.addEventListener("blur", () => this.hideSuggestions());

    // Clear filters
    document.getElementById("clear-filters")?.addEventListener("click", () => {
      Filters.clearAll();
      searchInput.value = "";
      this.renderSourceFilters();
      this.renderAdvancedFiltersPanel();
      this.renderSortControls();
      this.loadItems();
    });

    // Modal close on backdrop click
    document.getElementById("save-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "save-modal") {
        this.closeSaveModal();
      }
    });

    // Enter key in modal
    document
      .getElementById("save-search-name")
      ?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          this.confirmSaveSearch();
        }
      });
  },
};

// Initialize on load
document.addEventListener("DOMContentLoaded", () => App.init());
