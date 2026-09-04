/**
 * The one site nav — shared by every page, rendered from one list.
 *
 * Before this file each page carried its own hand-written row of links, so the
 * index offered seven flat destinations, four other pages offered two, and
 * nothing said which of the seven were views of the SAME thing. They are: the
 * Adoption Matrix, the Stack Ledger, the Adoption Radar and Ground Truth are
 * all lenses on ONE project, and What We Have is the dependency lens on the
 * same. So the nav has two rows:
 *
 *   row 1   Items - Projects - Discovery        three places, on every page
 *   row 2   <- all projects | apollo | the five lenses      only inside a project
 *
 * Row 2 appearing is what "you are inside apollo" looks like, and its back link is
 * how you leave. A page reached with ?project=<id> renders row 2 and marks its
 * own lens; a page reached without one renders row 1 alone, because a lens over
 * no project is the cross-project view and has no project to go back to.
 *
 * Pure: every function returns an HTML string. `mount()` is the only line that
 * touches the document, so the whole nav is unit-testable with no DOM.
 *
 * Everything lives inside one IIFE and the page gets exactly ONE global,
 * `window.SiteNav`. That is not tidiness: this file is loaded beside other
 * page scripts in the same global scope, and a top-level `function esc` here
 * collided with a top-level `const esc` in projects-hub-render.js, which is a
 * SyntaxError that killed the WHOLE renderer - the hub rendered "Could not load
 * the hub: route is not defined" until a screenshot showed it.
 */
(function (global) {

  /** The three places. Everything else is a lens on a project. */
  const PRIMARY = [
    { id: "items", label: "Items", href: "/" },
    { id: "projects", label: "Projects", href: "/projects.html" },
    { id: "discovery", label: "Discovery", href: "/project-radar.html" },
  ];

  /**
   * The lenses on one project, in the order you use them: what it needs, what we
   * scored for it, every repo it carries, its decision queue, its instruments.
   *
   * `needs` is the hub's own level 1 - a hash route, not a page - so the nav can
   * return you to the tree from any lens without a special case.
   */
  const PROJECT_VIEWS = [
    { id: "needs", label: "Needs", href: (p) => `/projects.html#/${encodeURIComponent(p)}` },
    { id: "matrix", label: "Adoption Matrix", href: (p) => `/adoption-matrix.html?project=${encodeURIComponent(p)}` },
    { id: "stack", label: "Stack Ledger", href: (p) => `/stack.html?project=${encodeURIComponent(p)}` },
    { id: "radar", label: "Adoption Radar", href: (p) => `/radar.html?project=${encodeURIComponent(p)}` },
    { id: "truth", label: "Ground Truth", href: (p) => `/ground-truth.html?project=${encodeURIComponent(p)}` },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  /**
   * One link. The active one carries THREE non-colour channels - a glyph (from
   * the stylesheet), bold weight, and aria-current - because hue is the one
   * channel this operator cannot read.
   */
  function link(href, label, on) {
    const cls = on ? ' class="on"' : "";
    const cur = on ? ' aria-current="page"' : "";
    return `<a href="${esc(href)}"${cls}${cur}>${esc(label)}</a>`;
  }

  /**
   * Row 1. `active` is one of the PRIMARY ids; every project lens marks
   * "Projects", because that is where it was reached from and where back goes.
   */
  function renderPrimary(active) {
    const items = PRIMARY.map((p) => link(p.href, p.label, p.id === active)).join(
      '<span class="sn-sep">&middot;</span>',
    );
    return `<div class="sn-row">
        <a class="sn-brand" href="/">AI Intelligence Hub</a>${items}
      </div>`;
  }

  /**
   * Row 2 — the project lens bar. Returns "" when no project is selected, which
   * is the honest rendering: without a project these pages are cross-project and
   * there is nothing to go back to.
   */
  function renderProjectBar(project, view) {
    if (!project) return "";
    const lenses = PROJECT_VIEWS.map((v) => link(v.href(project), v.label, v.id === view)).join(
      '<span class="sn-sep">&middot;</span>',
    );
    return `<div class="sn-row">
        <a class="sn-back" href="/projects.html">&larr; all projects</a>
        <span class="sn-proj">project <b>${esc(project)}</b></span>
        <span class="sn-sep">|</span>${lenses}
      </div>`;
  }

  /**
   * @param {object} [o]
   * @param {string} [o.active]  which PRIMARY id is current
   * @param {string} [o.project] the project id, when one is selected
   * @param {string} [o.view]    which PROJECT_VIEWS id is current
   */
  function renderSiteNav({ active = "", project = "", view = "" } = {}) {
    // A lens is always "under" Projects, so a page passing a project but no
    // active id still lights the right primary rather than none.
    const primary = active || (project ? "projects" : "");
    return `<nav class="sn" aria-label="Site">${renderPrimary(primary)}${renderProjectBar(project, view)}</nav>`;
  }

  /** The project id in the URL, or "" — the one thing every lens page reads. */
  function projectFromUrl(search) {
    const q = new URLSearchParams(search == null ? "" : search).get("project");
    return q ? String(q) : "";
  }

  /**
   * The only line that touches the document. Called with no arguments it reads
   * the page's own `data-nav-*` attributes, so a page declares where it is once,
   * in markup, and never repeats the link list.
   */
  function mount(opts) {
    const host = document.getElementById("site-nav");
    if (!host) return null;
    const o = opts || {
      active: host.dataset.navActive || "",
      view: host.dataset.navView || "",
      project: host.dataset.navProject || projectFromUrl(location.search),
    };
    host.innerHTML = renderSiteNav(o);
    return o;
  }

  const api = {
      renderSiteNav,
      renderPrimary,
      renderProjectBar,
      projectFromUrl,
      mount,
      link,
      esc,
      PRIMARY,
      PROJECT_VIEWS,
    };

    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (global) global.SiteNav = api;

    // Auto-mount: a page declares WHERE IT IS in markup and gets the nav for
    // free. Persistence is the requirement, so it must not depend on each page
    // remembering to call anything - the only thing a page can forget is the div,
    // and a test scans every page for exactly that.
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mount());
      else mount();
    }
  })(typeof window !== "undefined" ? window : null);
