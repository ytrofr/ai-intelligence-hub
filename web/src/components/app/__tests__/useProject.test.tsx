/**
 * useProject must call the SAME number of hooks on every render.
 *
 * The original read `useMatch("/p/:project/*") ?? useMatch("/p/:project")`.
 * `??` short-circuits, so the second useMatch ran only when the first missed:
 * two hooks on /projects, one hook on /p/x/matrix. React tracks hooks by call
 * ORDER within a component, so navigating between those two shapes desynced
 * the list and threw inside an unrelated useMemo - a stack trace naming
 * react-dom and react-router, and nothing of ours except the line number.
 *
 * Every existing shell cell mounted a FRESH tree at one path, which is exactly
 * the shape that cannot see this: with one render there is no second render to
 * disagree with. The reproducer therefore has to NAVIGATE inside one mounted
 * tree, and that is the whole point of this file.
 */

import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useProject } from "../useProject";

function Probe() {
  const project = useProject();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="project">{project ?? "none"}</output>
      <button onClick={() => navigate("/p/apollo/matrix")}>deep</button>
      <button onClick={() => navigate("/p/apollo")}>bare</button>
      <button onClick={() => navigate("/projects")}>away</button>
    </div>
  );
}

const read = () => screen.getByTestId("project").textContent;

describe("useProject", () => {
  it("survives navigation between matching and non-matching routes", () => {
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <Probe />
      </MemoryRouter>,
    );

    // Each click re-renders the SAME component instance. A conditional hook
    // throws on the first of these, not on the initial mount.
    expect(read()).toBe("none");
    fireEvent.click(screen.getByText("deep"));
    expect(read()).toBe("apollo");
    fireEvent.click(screen.getByText("away"));
    expect(read()).toBe("none");
    fireEvent.click(screen.getByText("bare"));
    expect(read()).toBe("apollo");
    fireEvent.click(screen.getByText("deep"));
    expect(read()).toBe("apollo");
  });

  it("reads the id from a deep lens and from the bare project route alike", () => {
    // The sidebar switcher and the breadcrumb disagreed here once already,
    // because useParams only sees the Route that rendered you. Both shapes
    // must give the same answer to anyone in the tree.
    for (const [path, want] of [
      ["/p/apollo", "apollo"],
      ["/p/apollo/matrix", "apollo"],
      ["/p/apollo/ground-truth", "apollo"],
      ["/projects", "none"],
      ["/", "none"],
    ] as const) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <Probe />
        </MemoryRouter>,
      );
      expect(read(), path).toBe(want);
      unmount();
    }
  });
});
