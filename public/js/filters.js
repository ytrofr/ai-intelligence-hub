/**
 * Filter Logic - Manage active filters, search, and sort
 */

const Filters = {
  state: {
    sources: [],
    search: "",
    dateFrom: "",
    dateTo: "",
    scoreMin: "",
    scoreMax: "",
    bookmarksOnly: false,
    sortBy: "score",
    sortOrder: "DESC",
  },

  init() {
    // Load from URL params
    const params = new URLSearchParams(window.location.search);
    if (params.has("sources")) {
      this.state.sources = params.get("sources").split(",").filter(Boolean);
    }
    if (params.has("search")) {
      this.state.search = params.get("search");
    }
    if (params.has("dateFrom")) {
      this.state.dateFrom = params.get("dateFrom");
    }
    if (params.has("dateTo")) {
      this.state.dateTo = params.get("dateTo");
    }
    if (params.has("scoreMin")) {
      this.state.scoreMin = params.get("scoreMin");
    }
    if (params.has("scoreMax")) {
      this.state.scoreMax = params.get("scoreMax");
    }
    if (params.has("bookmarksOnly")) {
      this.state.bookmarksOnly = params.get("bookmarksOnly") === "true";
    }
    if (params.has("sortBy")) {
      this.state.sortBy = params.get("sortBy");
    }
    if (params.has("sortOrder")) {
      this.state.sortOrder = params.get("sortOrder");
    }
  },

  toggleSource(sourceId) {
    const idx = this.state.sources.indexOf(sourceId);
    if (idx >= 0) {
      this.state.sources.splice(idx, 1);
    } else {
      this.state.sources.push(sourceId);
    }
    this.updateUrl();
    return this.state.sources;
  },

  setSearch(query) {
    this.state.search = query;
    this.updateUrl();
  },

  setDateRange(from, to) {
    this.state.dateFrom = from || "";
    this.state.dateTo = to || "";
    this.updateUrl();
  },

  setScoreRange(min, max) {
    this.state.scoreMin = min !== undefined ? min : "";
    this.state.scoreMax = max !== undefined ? max : "";
    this.updateUrl();
  },

  setBookmarksOnly(value) {
    this.state.bookmarksOnly = !!value;
    this.updateUrl();
  },

  setSort(sortBy, sortOrder) {
    this.state.sortBy = sortBy || "score";
    this.state.sortOrder = sortOrder || "DESC";
    this.updateUrl();
  },

  clearAll() {
    this.state = {
      sources: [],
      search: "",
      dateFrom: "",
      dateTo: "",
      scoreMin: "",
      scoreMax: "",
      bookmarksOnly: false,
      sortBy: "score",
      sortOrder: "DESC",
    };
    this.updateUrl();
  },

  getParams() {
    const params = {};
    if (this.state.sources.length > 0) {
      params.sources = this.state.sources.join(",");
    }
    if (this.state.search) {
      params.search = this.state.search;
    }
    if (this.state.dateFrom) {
      params.dateFrom = this.state.dateFrom;
    }
    if (this.state.dateTo) {
      params.dateTo = this.state.dateTo;
    }
    if (this.state.scoreMin !== "") {
      params.scoreMin = this.state.scoreMin;
    }
    if (this.state.scoreMax !== "") {
      params.scoreMax = this.state.scoreMax;
    }
    if (this.state.bookmarksOnly) {
      params.bookmarksOnly = "true";
    }
    if (this.state.sortBy !== "score") {
      params.sortBy = this.state.sortBy;
    }
    if (this.state.sortOrder !== "DESC") {
      params.sortOrder = this.state.sortOrder;
    }
    return params;
  },

  updateUrl() {
    const params = new URLSearchParams(this.getParams());
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  },

  hasActiveFilters() {
    return (
      this.state.sources.length > 0 ||
      this.state.search.length > 0 ||
      this.state.dateFrom ||
      this.state.dateTo ||
      this.state.scoreMin !== "" ||
      this.state.scoreMax !== "" ||
      this.state.bookmarksOnly
    );
  },

  // Get filter state for saving
  getFilterState() {
    return { ...this.state };
  },

  // Load a saved search
  loadSavedSearch(saved) {
    this.state.search = saved.query || "";
    if (saved.filters) {
      this.state.sources = saved.filters.sources || [];
      this.state.dateFrom = saved.filters.dateFrom || "";
      this.state.dateTo = saved.filters.dateTo || "";
      this.state.scoreMin = saved.filters.scoreMin ?? "";
      this.state.scoreMax = saved.filters.scoreMax ?? "";
      this.state.bookmarksOnly = saved.filters.bookmarksOnly || false;
    }
    this.state.sortBy = saved.sort_by || "score";
    this.updateUrl();
  },
};
