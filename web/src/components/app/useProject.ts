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
 */
export function useProject(): string | undefined {
  const match = useMatch("/p/:project/*") ?? useMatch("/p/:project");
  return match?.params.project;
}
