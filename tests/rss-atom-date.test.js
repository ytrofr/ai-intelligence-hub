const test = require("node:test");
const assert = require("node:assert/strict");
const RSSModule = require("../modules/rss");

test("toIso normalizes Atom/RFC dates and tolerates garbage", () => {
  const m = new RSSModule({ id: "x", name: "x", type: "rss", url: "http://x", config: {} });
  assert.equal(m.toIso("2026-02-18T10:00:00+02:00"), "2026-02-18T08:00:00.000Z");
  assert.equal(m.toIso("Tue, 18 Feb 2026 10:00:00 GMT"), "2026-02-18T10:00:00.000Z");
  assert.equal(m.toIso("not a date"), null);
  assert.equal(m.toIso(undefined), null);
});

test("atomLink picks the page link from the shapes xml2js really produces", () => {
  const m = new RSSModule({ id: "x", name: "x", type: "rss", url: "http://x", config: {} });
  // Verbatim shapes, 2026-10-16: Blogger, a single alternate, a typed alternate.
  assert.equal(
    m.atomLink([
      { $: { rel: "edit", type: "application/atom+xml", href: "http://www.blogger.com/feeds/1/posts/default/2" } },
      { $: { rel: "self", type: "application/atom+xml", href: "http://www.blogger.com/feeds/1/posts/default/2" } },
      { $: { rel: "alternate", type: "text/html", href: "https://ads-developers.googleblog.com/2026/10/post.html", title: "t" } },
    ]),
    "https://ads-developers.googleblog.com/2026/10/post.html",
  );
  assert.equal(m.atomLink({ $: { href: "https://simonwillison.net/2026/Oct/15/x/", rel: "alternate" } }), "https://simonwillison.net/2026/Oct/15/x/");
  assert.equal(m.atomLink({ $: { rel: "alternate", type: "text/html", href: "https://www.producthunt.com/products/x" } }), "https://www.producthunt.com/products/x");
  assert.equal(m.atomLink({ $: { href: "https://example.com/no-rel" } }), "https://example.com/no-rel", "no rel defaults to alternate");
  assert.equal(m.atomLink("https://example.com/plain"), "https://example.com/plain");
  assert.equal(m.atomLink([{ $: { rel: "self", href: "https://example.com/self" } }]), null, "only a self link is not a page");
  assert.equal(m.atomLink(undefined), null);
});
