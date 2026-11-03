/**
 * Source type `page-links` (2026-11-03) - a vendor index page with no feed, read as the
 * set of article LINKS on it. Each unique link matching config.link_regex is an item;
 * a link not seen before is news. First built for Anthropic news, whose RSS has answered
 * 404 since 2026-03, which left the hub with no Anthropic news at all.
 *
 * Honest by construction: published_at is null (the page gives no date we can trust);
 * first_seen_at, set on insert, is when we learned of it. A page that matches ZERO links
 * is an error - a redesign or a block page must never read as "no news".
 *
 * config: { base, link_regex, exclude?: [path], timeout_ms? }
 */
const crypto = require("crypto");
const BaseModule = require("./base-module");
const { fetchText } = require("./http");

const GENERIC = /^(read more|learn more|more|see more|continue reading)$/i;

function clean(text) {
  return String(text || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();
}

/** Pure: unique matching links in page order, with the best anchor text as title. */
function extractLinks(html, { base, link_regex, exclude = [] }) {
  const re = new RegExp(link_regex);
  const origin = new URL(base).origin;
  const byPath = new Map();
  const anchor = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = anchor.exec(html); m; m = anchor.exec(html)) {
    let url;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    const p = url.pathname.replace(/\/$/, "");
    if (!re.test(p) || exclude.includes(p)) continue;
    const text = clean(m[2]);
    const entry = byPath.get(p) || { url: origin + p, title: "" };
    if (!entry.title && text && !GENERIC.test(text)) entry.title = text.slice(0, 300);
    byPath.set(p, entry);
  }
  return [...byPath.values()].map((e) => ({ ...e, title: e.title || e.url.split("/").pop().replace(/-/g, " ") }));
}

class PageLinksModule extends BaseModule {
  constructor(config) {
    super(config);
    this.deps = config.deps || {};
  }

  async fetch() {
    const get = this.deps.fetchText || fetchText;
    const html = await get(this.url, { timeoutMs: this.config.timeout_ms || 20000, headers: { "User-Agent": "Mozilla/5.0 (ai-intelligence-hub)" } });
    const links = extractLinks(html, { base: this.config.base || this.url, link_regex: this.config.link_regex, exclude: this.config.exclude });
    if (!links.length) throw new Error(`${this.id}: 0 links matched ${this.config.link_regex} on ${this.url} - page changed or blocked`);
    return links.map((l) => ({
      id: `${this.id}-${crypto.createHash("md5").update(l.url).digest("hex").slice(0, 12)}`,
      source: this.id,
      title: l.title,
      url: l.url,
      description: "",
      author: this.name,
      stars: 0,
      score: 10,
      published_at: null,
      metadata: { via: "page-links" },
    }));
  }
}

module.exports = PageLinksModule;
module.exports.extractLinks = extractLinks;
