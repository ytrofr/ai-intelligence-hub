/**
 * The trust matrix - which project can PROVE each data + AI trust capability.
 *
 * Source of truth is outside this repo: ~/.claude/capabilities/registry.json (what
 * the capabilities are) and ~/.claude/state/capabilities/latest.json (what the
 * probe runner last found, capability-probe.py). This module only joins them.
 *
 * Display laws, same as ground-truth.js:
 *  - An absence is a ROW. A project or capability the state file does not mention
 *    renders as "unprobed", never as a missing cell and never as absent.
 *  - "error" is its own state: the probe could not judge. It is not absent.
 *  - Counts are derived from the rendered cells and nothing else.
 *
 * Pure: registry + state in, render tree out. The route does the IO.
 */

const STATES = ["live", "built", "absent", "error", "unprobed"];

function buildTrust({ registry, state }) {
  const caps = (registry && registry.capabilities) || [];
  const projectIds = (registry && registry.projects) || [];
  const stateProjects = (state && state.projects) || {};
  const controls = (state && state.capabilities) || {};

  const projects = projectIds.map((id) => {
    const sp = stateProjects[id] || {};
    const cells = {};
    for (const cap of caps) {
      const c = (sp.cells || {})[cap.id];
      cells[cap.id] = c && STATES.includes(c.state)
        ? {
            state: c.state,
            reason: c.reason || null,
            note: c.note || null,
            files: [...((c.impl && c.impl.files) || []), ...((c.caller && c.caller.files) || [])].slice(0, 6),
            prod: c.prod || null,
          }
        : { state: "unprobed", reason: c ? `unknown state ${String(c.state)}` : "never probed", note: null, files: [], prod: null };
    }
    return {
      id,
      trunk: sp.trunk || null,
      trunk_sha: sp.trunk_sha || null,
      checkout_behind_trunk: sp.checkout_behind_trunk ?? null,
      prod_status: sp.prod_status || null,
      probed_at: sp.probed_at || null,
      cells,
    };
  });

  const by_state = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const p of projects) for (const cap of caps) by_state[p.cells[cap.id].state] += 1;
  const cells = projects.length * caps.length;

  return {
    capabilities: caps.map((c) => ({
      id: c.id,
      name: c.name,
      spec: c.spec,
      control_project: c.control,
      control_fired: controls[c.id] ? controls[c.id].control_fired : null,
    })),
    projects,
    counts: { cells, probed: cells - by_state.unprobed, by_state },
    generated_at: (state && state.generated_at) || null,
  };
}

module.exports = { buildTrust, STATES };
