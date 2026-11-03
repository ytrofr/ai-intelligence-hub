/**
 * page-links: a vendor that publishes no feed (Anthropic news - its RSS has answered 404
 * since 2026-03) is read as the set of article LINKS on its index page. A new link is a
 * new item. No date is invented: published_at stays null, first_seen_at is the truth.
 * Also: rss max_items keeps a 2,000-entry changelog feed to its newest N.
 *
 * Run: node --test tests/page-links.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const PageLinksModule = require("../modules/page-links");
const { extractLinks } = PageLinksModule;
const { newestN } = require("../modules/rss");

const HTML = `
<a href="/news/claude-haiku-5-5"><h3>Introducing Claude Haiku 5.5</h3></a>
<a href="/news/claude-haiku-5-5">Read more</a>
<a href="/news/announcements">Announcements</a>
<a href="https://www.anthropic.com/news/the-full-claude-platform-on-google-cloud">The full Claude Platform, available on Google Cloud</a>
<a href="/careers">Careers</a>
<a href="/news/expanding-our-partnership-with-gsa?utm=x">GSA</a>`;

const cfg = { base: "https://www.anthropic.com", link_regex: "^/news/[a-z0-9-]+$", exclude: ["/news/announcements"] };

test("extractLinks: unique article links, absolute, excluded index pages, query stripped", () => {
  const links = extractLinks(HTML, cfg);
  assert.deepEqual(
    links.map((l) => l.url),
    [
      "https://www.anthropic.com/news/claude-haiku-5-5",
      "https://www.anthropic.com/news/the-full-claude-platform-on-google-cloud",
      "https://www.anthropic.com/news/expanding-our-partnership-with-gsa",
    ]
  );
  assert.equal(links[0].title, "Introducing Claude Haiku 5.5", "first non-generic anchor text wins");
  assert.equal(links[2].title, "GSA");
});

test("extractLinks: a link with no usable text gets a title from its slug, never empty", () => {
  const links = extractLinks('<a href="/news/claude-sonnet-5-5"><img src=x></a>', cfg);
  assert.equal(links[0].title, "claude sonnet 5 5");
});

test("fetch: a page with ZERO matching links is an error, not an empty success", async () => {
  const m = new PageLinksModule({ id: "anthropic-news", type: "page-links", url: "https://www.anthropic.com/news", config: cfg, deps: { fetchText: async () => "<html>maintenance</html>" } });
  await assert.rejects(m.fetch(), /0 links matched/);
});

test("fetch: items carry no invented date", async () => {
  const m = new PageLinksModule({ id: "anthropic-news", type: "page-links", url: "https://www.anthropic.com/news", config: cfg, deps: { fetchText: async () => HTML } });
  const items = await m.fetch();
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.published_at === null));
  assert.ok(items.every((i) => i.source === "anthropic-news"));
});

test("rss newestN: keeps the newest N by date; undated entries go last; 0/undefined = all", () => {
  const items = [
    { id: "a", published_at: "2026-10-01T00:00:00Z" },
    { id: "b", published_at: null },
    { id: "c", published_at: "2026-11-01T00:00:00Z" },
    { id: "d", published_at: "2026-10-15T00:00:00Z" },
  ];
  assert.deepEqual(newestN(items, 2).map((i) => i.id), ["c", "d"]);
  assert.deepEqual(newestN(items, undefined).map((i) => i.id), ["a", "b", "c", "d"]);
});
