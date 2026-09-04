const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  buildGroundTruth,
  validateFeatures,
} = require("../modules/ground-truth");
const { formatParkedPaidSection, formatFunnelSection } = require("../modules/digest-sections");

// ---------------------------------------------------------------------------
// H5 - kinds, features, ledger-fed candidates, paid-later parking.
//
// TDD: every refusal/absence assertion below sits beside a positive control
// on the same shape, so a matcher that always throws (or always passes) is
// caught the same run it is written.
// ---------------------------------------------------------------------------

const project = (over = {}) => ({
  id: "p",
  name: "P",
  features: [{ id: "f1", label: "Feature One" }],
  slots: [{ id: "s1", kind: "dataset", feature: "f1", ran: [] }],
  ...over,
});

// ---------------------------------------------------------------------------
// validateFeatures — fail-closed at the config boundary
// ---------------------------------------------------------------------------

test("CONTROL: validateFeatures passes a project whose slots all name a declared feature", () => {
  assert.doesNotThrow(() => validateFeatures([project()]));
});

test("CONTROL: validateFeatures passes a project with no slots at all, features or not", () => {
  assert.doesNotThrow(() => validateFeatures([{ id: "empty", slots: [] }]));
  assert.doesNotThrow(() => validateFeatures([{ id: "empty2" }]));
});

test("validateFeatures throws when a project has slots but no features[] declared", () => {
  const bad = { id: "nofeat", slots: [{ id: "s1", feature: "f1" }] };
  assert.throws(() => validateFeatures([bad]), /nofeat/, "must name the project");
});

test("validateFeatures throws when a slot names a feature the project never declared", () => {
  const bad = project({ slots: [{ id: "s1", kind: "dataset", feature: "ghost", ran: [] }] });
  assert.throws(() => validateFeatures([bad]), /p\/s1/, "must name the project/slot");
  assert.throws(() => validateFeatures([bad]), /ghost/, "must name the unknown feature");
});

test("validateFeatures throws when a slot declares no feature at all", () => {
  const bad = project({ slots: [{ id: "s1", kind: "dataset", ran: [] }] });
  assert.throws(() => validateFeatures([bad]), /p\/s1/);
});

// ---------------------------------------------------------------------------
// Slot kind normalization
// ---------------------------------------------------------------------------

test("CONTROL: legacy kind 'dataset' normalizes to 'ground-truth'", () => {
  const { projects } = buildGroundTruth({ projects: [project()] });
  assert.equal(projects[0].slots[0].kind, "ground-truth");
});

test("an absent kind normalizes to 'ground-truth' the same as an explicit 'dataset'", () => {
  const p = project({ slots: [{ id: "s1", feature: "f1", ran: [] }] });
  const { projects } = buildGroundTruth({ projects: [p] });
  assert.equal(projects[0].slots[0].kind, "ground-truth");
});

test("CONTROL: model/package/service/skill-eval pass through unchanged", () => {
  for (const kind of ["model", "package", "service", "skill-eval"]) {
    const p = project({ slots: [{ id: "s1", kind, feature: "f1", ran: [] }] });
    const { projects } = buildGroundTruth({ projects: [p] });
    assert.equal(projects[0].slots[0].kind, kind, `${kind} must survive unchanged`);
  }
});

test("an unrecognized slot kind throws, naming the project/slot", () => {
  const p = project({ slots: [{ id: "s1", kind: "wat", feature: "f1", ran: [] }] });
  assert.throws(() => buildGroundTruth({ projects: [p] }), /p\/s1/);
  assert.throws(() => buildGroundTruth({ projects: [p] }), /wat/);
});

// ---------------------------------------------------------------------------
// Feature resolution on the rendered slot row
// ---------------------------------------------------------------------------

test("a slot's feature id resolves to {id,label} from the project's declared features", () => {
  const { projects } = buildGroundTruth({ projects: [project()] });
  assert.deepEqual(projects[0].slots[0].feature, { id: "f1", label: "Feature One" });
});

test("CONTROL: a slot with no feature at all renders feature: null, not a crash", () => {
  const p = { id: "p2", name: "P2", slots: [{ id: "s1", kind: "dataset", ran: [] }] };
  const { projects } = buildGroundTruth({ projects: [p] });
  assert.equal(projects[0].slots[0].feature, null);
});

// ---------------------------------------------------------------------------
// Candidates merge two sources: items' matched_slots AND ledger rows
// ---------------------------------------------------------------------------

function ledgerRow(over = {}) {
  return {
    repo: "org/tool",
    kind: "repo",
    projects: ["p"],
    why: "",
    slot: "p/s1",
    cost_tier: "free",
    hardware_fit: "fits-cpu",
    hardware_mib: 512,
    state: "trial",
    score_total: 72,
    score: { basis: "measured" },
    ...over,
  };
}

test("a ledger row whose slot names project/slot becomes a candidate under that slot", () => {
  const { projects } = buildGroundTruth({ projects: [project()], ledgerRows: [ledgerRow()] });
  const cands = projects[0].slots[0].candidates;
  assert.equal(cands.length, 1);
  const c = cands[0];
  assert.equal(c.repo, "org/tool");
  assert.equal(c.kind, "repo");
  assert.equal(c.cost_tier, "free");
  assert.equal(c.hardware_fit, "fits-cpu");
  assert.equal(c.hardware_mib, 512);
  assert.equal(c.state, "trial");
  assert.equal(c.score_total, 72);
  assert.equal(c.basis, "measured");
  assert.equal(c.source, "ledger");
});

test("CONTROL: a ledger row naming a DIFFERENT slot does not leak into this one", () => {
  const { projects } = buildGroundTruth({
    projects: [project()],
    ledgerRows: [ledgerRow({ slot: "p/other-slot" })],
  });
  assert.equal(projects[0].slots[0].candidates.length, 0);
});

test("items and ledger candidates both land under the same slot, combined", () => {
  const p = project();
  const item = {
    id: "hf-1", title: "org/ds", url: "u",
    metadata: { kind: "dataset", matched_slots: [{ project: "p", slot: "s1" }] },
  };
  const { projects } = buildGroundTruth({ projects: [p], items: [item], ledgerRows: [ledgerRow()] });
  const cands = projects[0].slots[0].candidates;
  assert.equal(cands.length, 2);
  const sources = cands.map((c) => c.source).sort();
  assert.deepEqual(sources, ["items", "ledger"]);
});

// ---------------------------------------------------------------------------
// Counts: kind histogram, parked-paid (BOTH sources), funnel
// ---------------------------------------------------------------------------

test("counts.by_kind tallies normalized slot kinds", () => {
  const projects = [
    project({ id: "a", slots: [{ id: "s1", kind: "dataset", feature: "f1", ran: [] }] }),
    project({ id: "b", slots: [{ id: "s1", kind: "model", feature: "f1", ran: [] }] }),
  ];
  const { counts } = buildGroundTruth({ projects });
  assert.equal(counts.by_kind["ground-truth"], 1);
  assert.equal(counts.by_kind.model, 1);
});

test("counts.parked_paid lists ledger rows with cost_tier paid-later, with project + why", () => {
  const { counts } = buildGroundTruth({
    projects: [project()],
    ledgerRows: [ledgerRow({ cost_tier: "paid-later", why: "too pricey for now", slot: "" })],
  });
  assert.equal(counts.parked_paid.length, 1);
  assert.equal(counts.parked_paid[0].source, "ledger");
  assert.equal(counts.parked_paid[0].repo, "org/tool");
  assert.deepEqual(counts.parked_paid[0].projects, ["p"]);
  assert.equal(counts.parked_paid[0].why, "too pricey for now");
});

test("counts.parked_paid also lists a slot's own paid_later[] service strings", () => {
  const p = project({ slots: [{ id: "s1", kind: "service", feature: "f1", ran: [], paid_later: ["SEMrush - competitor keywords"] }] });
  const { counts } = buildGroundTruth({ projects: [p] });
  const slotEntries = counts.parked_paid.filter((e) => e.source === "slot");
  assert.equal(slotEntries.length, 1);
  assert.equal(slotEntries[0].project, "p");
  assert.equal(slotEntries[0].slot, "s1");
  assert.equal(slotEntries[0].text, "SEMrush - competitor keywords");
});

test("CONTROL: a slot with no paid_later[] contributes nothing to parked_paid", () => {
  const { counts } = buildGroundTruth({ projects: [project()] });
  assert.equal(counts.parked_paid.filter((e) => e.source === "slot").length, 0);
});

test("parked_paid merges BOTH sources in one list — a ledger row and a slot string together", () => {
  const p = project({ slots: [{ id: "s1", kind: "service", feature: "f1", ran: [], paid_later: ["Ahrefs"] }] });
  const { counts } = buildGroundTruth({
    projects: [p],
    ledgerRows: [ledgerRow({ cost_tier: "paid-later", slot: "" })],
  });
  assert.equal(counts.parked_paid.length, 2);
  const sources = counts.parked_paid.map((e) => e.source).sort();
  assert.deepEqual(sources, ["ledger", "slot"]);
});

test("counts.funnel is the ledger funnel over the ledger rows, 8-week window", () => {
  const now = new Date("2026-09-03T00:00:00Z");
  const row = ledgerRow({ status: "trial", first_seen: "2026-09-01T00:00:00Z", slot: "" });
  const { counts } = buildGroundTruth({ projects: [project()], ledgerRows: [row], now });
  assert.equal(counts.funnel.weeks.length, 8);
  assert.equal(counts.funnel.weeks[7], "2026-W36");
  assert.equal(counts.funnel.counts["2026-W36"].trial, 1);
});

test("CONTROL: no ledger rows at all still produces a well-formed empty funnel", () => {
  const { counts } = buildGroundTruth({ projects: [project()] });
  assert.equal(counts.funnel.weeks.length, 8);
  assert.equal(counts.parked_paid.length, 0);
});

// ---------------------------------------------------------------------------
// digest-sections.js — the two new digest sections
// ---------------------------------------------------------------------------

test("CONTROL: an empty parked-paid list says so plainly, not a blank section", () => {
  const md = formatParkedPaidSection([]);
  assert.match(md, /nothing parked/);
});

test("formatParkedPaidSection renders a ledger entry with its projects and why", () => {
  const md = formatParkedPaidSection([
    { source: "ledger", repo: "org/tool", projects: ["apollo", "hub"], why: "no free tier at our volume" },
  ]);
  assert.match(md, /org\/tool/);
  assert.match(md, /apollo, hub/);
  assert.match(md, /no free tier at our volume/);
});

test("formatParkedPaidSection renders a slot-string entry with no repo at all", () => {
  const md = formatParkedPaidSection([
    { source: "slot", project: "apollo", slot: "competitor-intel", text: "SEMrush - competitor keywords" },
  ]);
  assert.match(md, /apollo\/competitor-intel/);
  assert.match(md, /SEMrush - competitor keywords/);
});

test("formatParkedPaidSection renders BOTH sources together, one list", () => {
  const md = formatParkedPaidSection([
    { source: "ledger", repo: "org/tool", projects: ["p"], why: "" },
    { source: "slot", project: "p", slot: "s1", text: "Ahrefs" },
  ]);
  assert.match(md, /org\/tool/);
  assert.match(md, /Ahrefs/);
});

test("formatFunnelSection sums each stage across the whole window into one line", () => {
  const funnelData = {
    weeks: ["2026-W35", "2026-W36"],
    counts: {
      "2026-W35": { proposed: 2, accepted: 0, trial: 1, done: 0, rejected: 0 },
      "2026-W36": { proposed: 1, accepted: 0, trial: 0, done: 3, rejected: 0 },
      undated: { proposed: 99, accepted: 0, trial: 0, done: 0, rejected: 0 },
    },
  };
  const line = formatFunnelSection(funnelData);
  assert.match(line, /proposed 3/, "2+1 across the two named weeks");
  assert.match(line, /trial 1/);
  assert.match(line, /done 3/);
  assert.doesNotMatch(line, /proposed 102/, "undated must not leak into the windowed total");
});

test("CONTROL: an empty funnel window renders nothing rather than a broken line", () => {
  assert.equal(formatFunnelSection({ weeks: [], counts: {} }), "");
});

// ---------------------------------------------------------------------------
// The three digest link-escape sites (renderItem, renderTLDR,
// formatProjectSections) must all use the same mdLinkText helper the
// ground-truth section already uses — a title carrying `](` must not be able
// to close its link early and open its own.
// ---------------------------------------------------------------------------

test("every markdown link built in weekly-digest.js from a title escapes `[` and `]`", () => {
  const { formatDigest, formatProjectSections } = require("../modules/weekly-digest");
  const evil = "evil](https://attacker.example)[";
  const digestMd = formatDigest({
    items: [{ id: "x", title: evil, url: "https://real.example", stars: 1, description: "" }],
    runDate: "2026-09-03",
  });
  assert.ok(!digestMd.includes("[evil](https://attacker.example)[]("),
    "an unescaped title can still close the link early");
  assert.match(digestMd, /\\\[/, "the escaped bracket must actually appear");
});

