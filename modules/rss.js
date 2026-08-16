/**
 * RSS Module - Generic RSS/Atom feed parser
 */

const BaseModule = require("./base-module");
const { parseStringPromise } = require("xml2js");
const { fetchText } = require("./http");

class RSSModule extends BaseModule {
  /**
   * Throws on HTTP error / timeout / unparseable feed - the runner records it.
   * A feed that is reachable but has 0 entries returns [] (honest empty).
   */
  async fetch() {
    const items = [];
    const xml = await fetchText(this.url, {
      timeoutMs: this.config.timeout_ms || 20000,
    });
    let parsed;
    try {
      parsed = await parseStringPromise(xml, { explicitArray: false });
    } catch (err) {
      throw new Error(`RSS parse error for ${this.id}: ${err.message}`);
    }
    if (!parsed || (!parsed.rss && !parsed.feed)) {
      throw new Error(`Not an RSS/Atom document: ${this.url} (${xml.slice(0, 60).replace(/\s+/g, " ")}...)`);
    }
    {

      // Handle RSS 2.0
      if (parsed.rss?.channel?.item) {
        const feedItems = Array.isArray(parsed.rss.channel.item)
          ? parsed.rss.channel.item
          : [parsed.rss.channel.item];

        for (const item of feedItems) {
          items.push(
            this.normalize({
              id: item.guid?._ || item.guid || item.link,
              title: item.title,
              url: item.link,
              description: this.stripHtml(item.description || ""),
              author: this.extractAuthor(item.author || item["dc:creator"]),
              published_at: this.toIso(item.pubDate),
              score: this.getRecencyScore(item.pubDate) * 10,
            }),
          );
        }
      }

      // Handle Atom
      if (parsed.feed?.entry) {
        const entries = Array.isArray(parsed.feed.entry)
          ? parsed.feed.entry
          : [parsed.feed.entry];

        for (const entry of entries) {
          const link = entry.link?.href || entry.link?.[0]?.href || entry.link;
          items.push(
            this.normalize({
              id: entry.id || link,
              title: entry.title?._ || entry.title,
              url: typeof link === "string" ? link : link?.href,
              description: this.stripHtml(
                entry.summary?._ || entry.summary || entry.content?._ || "",
              ),
              author: entry.author?.name,
              published_at: this.toIso(entry.published || entry.updated),
              score:
                this.getRecencyScore(entry.published || entry.updated) * 10,
            }),
          );
        }
      }
    }

    return items;
  }

  toIso(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  extractAuthor(val) {
    if (!val) return null;
    if (typeof val === "string") return val;
    if (Array.isArray(val))
      return val
        .map((a) => a?.name || "")
        .filter(Boolean)
        .join(", ");
    if (typeof val === "object")
      return val.name || JSON.stringify(val).substring(0, 100);
    return String(val);
  }

  stripHtml(html) {
    return html.replace(/<[^>]*>/g, "").substring(0, 500);
  }

  getRecencyScore(dateStr) {
    if (!dateStr) return 5;
    const hours = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
    if (hours < 6) return 20;
    if (hours < 24) return 15;
    if (hours < 72) return 10;
    return 5;
  }
}

module.exports = RSSModule;
