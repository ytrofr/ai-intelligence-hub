/**
 * Two things a person cannot check by looking, measured on the rendered page.
 *
 *   CONTRAST  every run of text against what is actually PAINTED behind it,
 *             in both themes.
 *   TARGETS   every interactive control against the 44px touch floor, at a
 *             phone width.
 *
 * Contrast is read from PIXELS, not from CSS. A resolved colour is a selection,
 * not a verdict: a translucent, blurred or overlapped surface composites to
 * something the cascade never names, and this app has exactly that - the header
 * is `bg-background/95 backdrop-blur`. So each theme/route is screenshotted once
 * and every text rect is sampled out of that image. The background is the modal
 * colour in the rect; the ink is the pixel furthest from it in luminance that
 * appears often enough not to be an anti-aliasing artefact.
 *
 * THREE STATES, never two: readable / not readable / NOT MEASURED. An element
 * whose rect yields no ink (an empty box, a clipped run, a glyph too thin to
 * reach its own colour) is unmeasured, and unmeasured is not a pass.
 *
 * Both checks carry a planted positive control and the run REFUSES to report a
 * clean page if its control did not fire - a scan that cannot fail looks exactly
 * like a healthy app.
 *
 * Playwright is not a dependency of this repo and is not installed by it.
 *
 *   PLAYWRIGHT_MODULE=/path/to/playwright \
 *   HUB_URL=http://localhost:4444 HUB_PROJECT=<id> node web/scripts/a11y-probe.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const BASE = process.env.HUB_URL ?? "http://localhost:4444";
const PROJECT = process.env.HUB_PROJECT ?? "";
const THEMES = (process.env.HUB_THEMES ?? "dark,light").split(",");

const ROUTES = [
  "/", "/digests", "/discovery", "/projects", "/inventory",
  ...(PROJECT
    ? ["", "/matrix", "/stack", "/radar", "/ground-truth"].map((s) => `/p/${PROJECT}${s}`)
    : []),
];

let chromium, PNG;
try {
  const mod = process.env.PLAYWRIGHT_MODULE ?? "playwright";
  ({ chromium } = require(mod));
  // The PNG decoder playwright already ships for its own image comparison, so
  // one env var locates everything and this script adds no dependency at all.
  // By FILE PATH, not by specifier: playwright-core's package exports map does
  // not expose this, and a bare specifier is refused before it is ever looked
  // for. The file itself has been there since 1.30.
  const core = path.dirname(require.resolve("playwright-core", { paths: [require.resolve(mod)] }));
  ({ PNG } = require(path.join(core, "lib", "utilsBundle.js")));
} catch (e) {
  console.log(
    `SKIPPED: playwright or pngjs not resolvable (${e.message}).\n` +
      "  This is a skip, not a pass - nothing was measured.",
  );
  process.exit(0);
}

/* ---- WCAG arithmetic. sRGB relative luminance, then the standard ratio. ---- */
const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

/* ---- What the page reports about itself. Colours come from the image. ---- */
const COLLECT = () => {
  // The control: text painted in its own background colour. It must come back
  // as a failure, or this run has measured nothing it can vouch for.
  const probe = document.createElement("p");
  probe.id = "__contrast_control__";
  probe.textContent = "planted control - this text must be reported unreadable";
  probe.style.cssText =
    "position:fixed;left:8px;top:8px;z-index:2147483646;font-size:16px;padding:4px;" +
    "background:#808080;color:#828282;";
  document.body.appendChild(probe);

  // Touch targets. Its control is planted too, for the same reason.
  const tiny = document.createElement("button");
  tiny.id = "__target_control__";
  tiny.textContent = "x";
  tiny.style.cssText =
    // !important on every dimension: this pass added a coarse-pointer
    // min-height to `button`, which grew the control to 20x44 and moved it
    // out of the failing bucket. A control the code under test can resize is
    // not a control - it is another element on the page.
    "position:fixed;right:8px;bottom:8px;z-index:2147483646;" +
    "width:20px!important;height:20px!important;min-width:20px!important;" +
    "min-height:20px!important;max-height:20px!important;padding:0;";
  document.body.appendChild(tiny);

  const path = (el) => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
      bits.unshift(n.id ? `#${n.id}` : n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? `.${n.className.trim().split(/\s+/)[0]}` : ""));
    }
    return bits.join(">");
  };

  // Both controls are position:fixed and therefore paint OVER real content. An
  // element under one of them is occluded: its pixels are the control's, not
  // its own. Measuring it anyway reported the control's 1.03:1 against a
  // breadcrumb's name - the instrument finding itself and blaming the page.
  const covers = [probe, tiny].map((el) => el.getBoundingClientRect());
  const occluded = (r) =>
    covers.some((c) => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top);

  const text = [];
  for (const el of document.querySelectorAll("body *")) {
    // Only elements whose OWN direct text is their whole visible content. An
    // element wrapping other painted elements would put their pixels in the
    // rect and make the sample meaningless.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!own) continue;
    if ([...el.children].some((c) => c.getClientRects().length > 0)) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.top >= innerHeight || r.bottom <= 0 || r.left >= innerWidth || r.right <= 0) continue;
    if (el.id !== "__contrast_control__" && occluded(r)) continue;

    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    // The ink, exactly, plus every opacity between it and the page. Reading the
    // ink off pixels instead looked rigorous and was not: antialiasing means a
    // two-glyph number may never paint a single pixel of its own colour, and
    // the probe then reported the halfway blend as the text. The SURFACE is
    // what CSS cannot tell you; the ink it can, as long as the opacity chain is
    // carried with it.
    let alpha = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      alpha *= Number(getComputedStyle(n).opacity);
    }
    const m = cs.color.match(/[\d.]+/g) ?? [];
    text.push({
      sel: path(el),
      text: own.slice(0, 40),
      ink: [Number(m[0]), Number(m[1]), Number(m[2])],
      colorRaw: cs.color,
      alpha: alpha * (m.length > 3 ? Number(m[3]) : 1),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      // WCAG splits the floor by what the thing IS. Large text is 3.0 (24px,
      // or 18.66px bold). So is a GRAPHIC - and an aria-hidden mark is exactly
      // that: it is hidden from the accessibility tree precisely because the
      // word beside it carries the meaning, which is this app's own rule about
      // colour never travelling alone. Holding it to the body-text floor would
      // be measuring a decoration as if it were the sentence.
      floor: el.getAttribute("aria-hidden") === "true" || px >= 24 || (bold && px >= 18.66) ? 3.0 : 4.5,
      px,
      control: el.id === "__contrast_control__",
    });
  }

  // Touch targets, using the control planted above.
  const targets = [];
  const SEL = 'a[href],button,[role="button"],[role="tab"],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  /**
   * WCAG 2.2 exempts a target that sits INLINE in a run of text - a link in a
   * sentence cannot be 44px tall without wrecking the sentence, and SC 2.5.8
   * says so explicitly. Detected structurally: an inline element whose parent
   * also holds text of its own.
   */
  const inlineInText = (el) => {
    const p = el.parentElement;
    if (!p || getComputedStyle(el).display !== "inline") return false;
    return [...p.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
  };
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
    // sr-only: present for a screen reader, clipped to nothing for a finger.
    // Its 1px rect is not a target that is too small, it is not a target.
    if (cs.clipPath.includes("inset(50%") || cs.clip === "rect(0px, 0px, 0px, 0px)") continue;
    targets.push({
      sel: path(el),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
      w: Math.round(r.width),
      h: Math.round(r.height),
      inline: inlineInText(el),
      control: el.id === "__target_control__",
    });
  }
  return { text, targets };
};

/**
 * The surface, from pixels: the modal colour inside the rect. Also returns the
 * furthest pixel from it, purely as a CROSS-CHECK - if something is painted
 * over this element that is darker or lighter than the ink we computed, the
 * measurement is not ours to make and the element is reported UNMEASURED.
 */
function sample(png, rect, dpr) {
  const x0 = Math.max(0, Math.round(rect.x * dpr));
  const y0 = Math.max(0, Math.round(rect.y * dpr));
  const x1 = Math.min(png.width, Math.round((rect.x + rect.w) * dpr));
  const y1 = Math.min(png.height, Math.round((rect.y + rect.h) * dpr));
  if (x1 <= x0 || y1 <= y0) return null;

  const counts = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (png.width * y + x) << 2;
      const k = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const rgb = (k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255];
  let bgKey = -1, bgN = 0;
  for (const [k, n] of counts) if (n > bgN) { bgN = n; bgKey = k; }
  const bg = rgb(bgKey);
  const bgL = lum(bg);

  let far = 0, farC = null;
  for (const [k, n] of counts) {
    if (n < 2 || k === bgKey) continue;
    const d = Math.abs(lum(rgb(k)) - bgL);
    if (d > far) { far = d; farC = rgb(k); }
  }
  return { bg, farthest: far, farthestColour: farC };
}

/** src over dst at alpha - what the compositor actually puts on the screen. */
const over = (src, dst, a) => src.map((v, i) => Math.round(v * a + dst[i] * (1 - a)));

const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

const run = async () => {
  const browser = await chromium.launch();
  const findings = { contrast: [], targets: [] };
  let textSeen = 0, unmeasured = 0, targetSeen = 0, exempt = 0;
  const aspiration = [];
  let contrastControlFired = false, targetControlFired = false;

  for (const theme of THEMES) {
    // 390 is the phone width the rest of this repo measures at, and the touch
    // floor is only meaningful at a width where fingers are the pointer.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 900 },
      deviceScaleFactor: 1,
      // Touch, so `(pointer: coarse)` is TRUE. A desktop pointer would measure
      // the page nobody applies the touch floor to.
      hasTouch: true,
    });
    await ctx.addInitScript((t) => {
      try { localStorage.setItem("theme", t); } catch { /* storage blocked */ }
    }, theme);
    const page = await ctx.newPage();

    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(350);

      const applied = await page.evaluate(() =>
        document.documentElement.classList.contains("dark") ? "dark" : "light");
      if (applied !== theme) {
        console.log(`  !! ${route}: asked for ${theme}, page rendered ${applied}`);
      }

      const { text, targets } = await page.evaluate(COLLECT);
      const png = PNG.sync.read(await page.screenshot());

      for (const t of text) {
        textSeen++;
        const s = sample(png, t.rect, 1);
        if (!s || !Number.isFinite(t.alpha) || t.ink.some((v) => !Number.isFinite(v))) {
          unmeasured++;
          const why = !s
            ? "rect has no pixels in the viewport"
            : !Number.isFinite(t.alpha)
              ? "opacity chain did not resolve"
              : `colour did not parse: ${t.colorRaw}`;
          if (!t.control) findings.contrast.push({ theme, route, ...t, state: "not measured", why });
          continue;
        }
        const ink = over(t.ink, s.bg, t.alpha);
        const r = ratio(s.bg, ink);
        // Something is painted here that we did not account for. Not a pass.
        if (s.farthest > Math.abs(lum(ink) - lum(s.bg)) * 1.15 + 0.02) {
          unmeasured++;
          if (!t.control) {
            findings.contrast.push({
              theme, route, ...t, state: "not measured", ratio: r, bg: hex(s.bg), inkHex: hex(ink),
              // WHY it is unmeasured: something in this rect is painted further
              // from the surface than the ink we computed, so the ink is not
              // the darkest thing here and the ratio is not the one that matters.
              overpaint: s.farthestColour ? hex(s.farthestColour) : null,
            });
          }
          continue;
        }
        if (r + 0.005 < t.floor) {
          if (t.control) { contrastControlFired = true; continue; }
          findings.contrast.push({
            theme, route, ...t, state: "not readable",
            ratio: r, bg: hex(s.bg), inkHex: hex(ink),
          });
        }
      }
      for (const g of targets) {
        targetSeen++;
        if (g.w >= 44 && g.h >= 44) continue;
        // 24px is WCAG 2.2 AA (SC 2.5.8) and is the FLOOR - under it is a
        // finding. 44px is AAA (SC 2.5.5) and this repo's house rule, so a
        // target between the two is reported separately as an aspiration
        // rather than mixed in with the failures.
        if (g.w >= 24 && g.h >= 24) { aspiration.push({ theme, route, ...g }); continue; }
        if (g.control) { targetControlFired = true; continue; }
        if (g.inline) { exempt++; continue; }
        findings.targets.push({ theme, route, ...g });
      }
    }
    await ctx.close();
  }
  await browser.close();

  const dedupe = (rows, key) => {
    const seen = new Map();
    for (const r of rows) { const k = key(r); if (!seen.has(k)) seen.set(k, r); }
    return [...seen.values()];
  };

  console.log(`\npopulation: ${textSeen} text runs, ${targetSeen} controls`);
  console.log(`            ${THEMES.length} theme(s) x ${ROUTES.length} routes at 390px`);
  console.log(`positive control (contrast, #828282 on #808080): ${contrastControlFired ? "FIRED" : "*** DID NOT FIRE ***"}`);
  console.log(`positive control (target, 20x20 button):         ${targetControlFired ? "FIRED" : "*** DID NOT FIRE ***"}`);
  console.log(`not measured: ${unmeasured} (an unmeasured run is NOT a pass)`);

  const c = dedupe(findings.contrast, (r) => `${r.theme}|${r.sel}|${r.text}`);
  const g = dedupe(findings.targets, (r) => `${r.sel}|${r.label}`);

  const below = c.filter((r) => r.state === "not readable");
  const unmeas = c.filter((r) => r.state === "not measured");
  console.log(`\nCONTRAST below floor: ${below.length}   could not be measured: ${unmeas.length}`);
  console.log("  (the two are listed together below but they are different verdicts:");
  console.log("   below-floor is a defect, unmeasured is an absence of evidence)");

  // Grouped by the COLOUR PAIR, because that is the unit a fix acts on. 217
  // failing elements are not 217 problems; they are a handful of token pairs
  // used in a lot of places, and a per-element list hides that completely.
  const pairs = new Map();
  for (const r of c) {
    const k = `${r.theme}|${r.state}|${r.inkHex ?? "-"}|${r.bg ?? "-"}|${r.floor}`;
    const g = pairs.get(k) ?? { ...r, n: 0, where: new Set() };
    g.n++;
    g.where.add(r.route);
    pairs.set(k, g);
  }
  console.log("  by colour pair (the unit a fix acts on):");
  for (const g of [...pairs.values()].sort((a, b) => b.n - a.n)) {
    const r = g.ratio === undefined || g.ratio === null ? "not measured" : `${g.ratio.toFixed(2)}:1`;
    console.log(
      `    ${g.theme.padEnd(5)} ${String(g.n).padStart(3)}x  ${r.padEnd(12)} needs ${g.floor}  ` +
        `${g.inkHex ?? "?"} on ${g.bg ?? "?"}${g.overpaint ? ` [overpainted by ${g.overpaint}]` : ""}${g.why ? ` [${g.why}]` : ""}  e.g. "${g.text}" (${[...g.where].slice(0, 3).join(" ")})`,
    );
  }

  console.log("\n  every failing element:");
  for (const r of c.slice(0, 40)) {
    console.log(
      `  ${r.theme.padEnd(5)} ${r.state === "not measured" ? "not measured" : `${r.ratio.toFixed(2)}:1 (needs ${r.floor})  ${r.ink} on ${r.bg}`}` +
        `\n        ${r.route}  ${r.sel}\n        "${r.text}"`,
    );
  }
  const asp = dedupe(aspiration, (r) => `${r.sel}|${r.label}`);
  console.log(`\nTOUCH TARGETS under the 24px WCAG 2.2 AA floor: ${g.length}`);
  console.log(`  (${exempt} inline-in-text targets exempt under SC 2.5.8)`);
  for (const r of g.slice(0, 40)) {
    console.log(`  ${r.w}x${r.h}  ${r.sel}  "${r.label}"`);
  }

  console.log(`\n  between 24px and the 44px house rule (aspiration, not a failure): ${asp.length}`);
  for (const r of asp.slice(0, 30)) console.log(`    ${r.w}x${r.h}  ${r.sel}  "${r.label}"`);

  if (!contrastControlFired || !targetControlFired) {
    console.log("\nA control did not fire. This report is not evidence.");
    process.exit(2);
  }
  // Unmeasured exits non-zero too. It is not a pass; it is a gap.
  process.exit(below.length || unmeas.length || g.length ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(3); });
