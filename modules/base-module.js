/**
 * Base Module - Abstract class for all data source modules
 */

class BaseModule {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.url = config.url;
    this.rateLimitMinutes = config.rate_limit_minutes || 60;
    this.config = config.config || {};
  }

  /**
   * Check if enough time has passed since last fetch
   */
  canFetch(lastFetchedAt) {
    if (!lastFetchedAt) return true;
    const elapsed = Date.now() - new Date(lastFetchedAt).getTime();
    return elapsed >= this.rateLimitMinutes * 60 * 1000;
  }

  /**
   * Fetch items from the source - must be implemented by subclass
   * @returns {Promise<Array>} Array of normalized items
   */
  async fetch() {
    throw new Error("fetch() must be implemented by subclass");
  }

  /**
   * Normalize an item to common format
   */
  normalize(raw) {
    return {
      id: `${this.id}-${raw.id || this.generateId(raw)}`,
      source: this.id,
      title: raw.title || "Untitled",
      url: raw.url || "",
      description: raw.description || "",
      author: raw.author || null,
      stars: raw.stars || 0,
      score: raw.score || 0,
      published_at: raw.published_at || new Date().toISOString(),
      metadata: raw.metadata || {},
    };
  }

  generateId(raw) {
    const str = raw.title + raw.url;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

module.exports = BaseModule;
