/**
 * Does any page scroll sideways on a phone, and if so, what is sticking out?
 *
 * Two things this measures that a naive scan does not:
 *
 *  - it names the culprit by its RIGHT EDGE, not its width. A narrow element
 *    positioned past the edge is invisible to a width scan, and a width scan
 *    reports the same number for every layout - which is the tell that the
 *    instrument, not the page, is the variable.
 *  - it ignores anything inside an `overflow-x: auto` box. A wide table
 *    scrolling in its own container is the design, not a defect, and counting
 *    it buries the one element that genuinely escapes.
 *
 * Playwright is NOT a dependency of this repo and is not installed by it - the
 * box this runs on has no room for that install. Point PLAYWRIGHT_MODULE at an
 * existing one, or the script says so and exits 0 rather than reporting a clean
 * page it never looked at.
 *
 *   HUB_URL=http://localhost:4444 node web/scripts/no-sideways-scroll.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BASE = process.env.HUB_URL ?? "http://localhost:4444";
const PROJECT = process.env.HUB_PROJECT ?? "";
const WIDTHS = [320, 390];

const ROUTES = [
  "/", "/digests", "/discovery", "/projects", "/inventory", "/design",
  ...(PROJECT
    ? ["", "/matrix", "/stack", "/radar", "/ground-truth"].map((s) => `/p/${PROJECT}${s}`)
    : []),
];

let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright"));
} catch {
  console.log(
    "SKIPPED: playwright not resolvable. Set PLAYWRIGHT_MODULE to an installed copy.\n" +
      "  This is a skip, not a pass - nothing was measured.",
  );
  process.exit(0);
}

// The scan has to be able to say FAIL. Plant a box wider than the viewport and
// require it to be caught; a clean report from a scan that cannot fire looks
// exactly like a healthy app.
const PROBE = (vw) => {
  const clipped = (el) => {
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
    }
    return false;
  };
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    if (b.right <= vw + 0.5 || clipped(el)) continue;
    let d = 0;
    for (let n = el; (n = n.parentElement); ) d++;
    out.push({
      over: Math.round(b.right - vw),
      w: Math.round(b.width),
      d,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className?.baseVal ?? el.className ?? "").slice(0, 60),
    });
  }
  out.sort((a, b) => a.d - b.d);
  return {
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    escaping: out.slice(0, 5),
  };
};

const browser = await chromium.launch();
let failures = 0;

const control = await browser.newPage({ viewport: { width: 320, height: 800 } });
await control.goto(`${BASE}/`, { waitUntil: "networkidle" });
await control.evaluate(() => {
  const d = document.createElement("div");
  d.style.cssText = "width:900px;height:20px";
  document.body.appendChild(d);
});
const ctl = await control.evaluate(PROBE, 320);
await control.close();
if (ctl.escaping.length === 0) {
  console.error("POSITIVE CONTROL DID NOT FIRE - the scan is blind. Nothing below is evidence.");
  await browser.close();
  process.exit(2);
}
console.log(`positive control: FIRED (+${ctl.escaping[0].over}px on a planted 900px box)`);
console.log(`population: ${ROUTES.length} routes x ${WIDTHS.length} widths` +
  (PROJECT ? "" : "  (set HUB_PROJECT to include the five per-project lenses)"));

for (const w of WIDTHS) {
  for (const route of ROUTES) {
    const page = await browser.newPage({ viewport: { width: w, height: 800 } });
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const r = await page.evaluate(PROBE, w);
    await page.close();
    if (r.scroll > 0) {
      failures++;
      console.error(`FAIL ${route} @${w}: scrolls ${r.scroll}px sideways`);
      for (const e of r.escaping) console.error(`       +${e.over}px  ${e.tag}  ${e.cls}`);
    }
  }
}

await browser.close();
console.log(failures === 0 ? "no page scrolls sideways" : `${failures} page(s) scroll sideways`);
process.exit(failures === 0 ? 0 : 1);
