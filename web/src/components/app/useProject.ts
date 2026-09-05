import { useMatch } from "react-router-dom";

/**
 * The project id from the URL, readable ANYWHERE inside the router.
 *
 * `useParams` only sees params from the <Route> that rendered you, and the
 * sidebar is a sibling of <Routes>, not a child - so it read `{}` on every
 * route and the switcher said "no project selected" while the breadcrumb three
 * pixels away said the project's name. Two components disagreeing about what
 * the URL says is the shape of bug that survives review, because each one is
 * correct about its own scope.
 *
 * `useMatch` matches the location itself, so there is one answer for the whole
 * tree.
 *
 * BOTH patterns are matched UNCONDITIONALLY, and that is load-bearing rather
 * than stylistic. Written as `useMatch(deep) ?? useMatch(bare)` the `??`
 * short-circuits, so the second hook ran only on the routes where the first
 * missed - two hooks on /projects, one on /p/x/matrix. React identifies hooks
 * by call order, so the first NAVIGATION between those two shapes desynced the
 * list and threw inside an unrelated useMemo. The stack named react-dom and
 * react-router and nothing of ours but a line number.
 *
 * A single render can never show this. Its guard has to navigate:
 * `__tests__/useProject.test.tsx`.
 */
export function useProject(): string | undefined {
  const deep = useMatch("/p/:project/*");
  const bare = useMatch("/p/:project");
  return (deep ?? bare)?.params.project;
}
