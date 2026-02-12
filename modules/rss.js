/**
 * RSS Module - Generic RSS/Atom feed parser
 */

const BaseModule = require("./base-module");
const { parseStringPromise } = require("xml2js");

class RSSModule extends BaseModule {
  async fetch() {
    const items = [];

    try {
      const res = await fetch(this.url, {
        headers: { "User-Agent": "AI-Intelligence-Hub/1.0" },
      });

      if (!res.ok) {
        console.error(`RSS fetch failed for ${this.id}: ${res.status}`);
        return items;
      }

      const xml = await res.text();
      const parsed = await parseStringPromise(xml, { explicitArray: false });

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
              author: item.author || item["dc:creator"],
              published_at: item.pubDate
                ? new Date(item.pubDate).toISOString()
                : null,
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
              published_at: entry.published || entry.updated,
              score:
                this.getRecencyScore(entry.published || entry.updated) * 10,
            }),
          );
        }
      }
    } catch (err) {
      console.error(`RSS parse error for ${this.id}:`, err.message);
    }

    return items;
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
