/**
 * API Client - Wrapper for all API calls
 */

const API = {
  async get(endpoint) {
    const res = await fetch(`/api${endpoint}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },

  async post(endpoint, data = {}) {
    const res = await fetch(`/api${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },

  async put(endpoint, data = {}) {
    const res = await fetch(`/api${endpoint}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },

  async delete(endpoint) {
    const res = await fetch(`/api${endpoint}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },

  // Items with advanced filtering
  getItems: (params = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, value);
      }
    }
    const queryStr = query.toString();
    return API.get(`/items${queryStr ? "?" + queryStr : ""}`);
  },

  // Sources
  fetchSources: (sourceId) => API.post("/fetch", sourceId ? { sourceId } : {}),
  getStats: () => API.get("/stats"),
  getSources: () => API.get("/sources"),
  toggleSource: (id, enabled) => API.put(`/sources/${id}/toggle`, { enabled }),

  // Bookmarks
  getBookmarks: () => API.get("/bookmarks"),
  addBookmark: (itemId, note) => API.post("/bookmarks", { itemId, note }),
  removeBookmark: (itemId) =>
    API.delete(`/bookmarks/${encodeURIComponent(itemId)}`),

  // Search features
  getSearchSuggestions: (q) =>
    API.get(`/search/suggestions?q=${encodeURIComponent(q || "")}`),
  getRecentSearches: () => API.get("/search/recent"),
  getSavedSearches: () => API.get("/search/saved"),
  saveSearch: (name, query, filters, sortBy) =>
    API.post("/search/saved", { name, query, filters, sortBy }),
  deleteSavedSearch: (id) => API.delete(`/search/saved/${id}`),
};
