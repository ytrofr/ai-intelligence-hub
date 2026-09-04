import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

/**
 * Three states, never two: loading, error, data.
 *
 * A hook that returns only `data | undefined` forces every caller to render an
 * absence and a failure identically, and the house rule here is that an absence
 * is a ROW - a visible one, saying which of the two it is.
 */
export type Async<T> =
  | { state: "loading" }
  | { state: "error"; error: ApiError | Error }
  | { state: "ready"; data: T };

export function useApi<T>(path: string | null): Async<T> {
  const [result, setResult] = useState<Async<T>>({ state: "loading" });

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setResult({ state: "loading" });
    api<T>(path)
      .then((data) => live && setResult({ state: "ready", data }))
      .catch((error) => live && setResult({ state: "error", error }));
    return () => {
      live = false;
    };
  }, [path]);

  return result;
}
