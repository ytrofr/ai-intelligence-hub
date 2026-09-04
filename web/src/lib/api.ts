/**
 * The only place this app calls the network.
 *
 * Same origin, always: Express serves the built bundle on 4444 and the API from
 * the same port, so there is no proxy, no CORS and no base-URL configuration to
 * get wrong. The env override exists for a test harness, not for deployment.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    // The status and the path both travel with the error. A UI that only has
    // "request failed" cannot tell the reader whether the thing is missing or
    // the server is unwell, and those need different words on the page.
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* a non-JSON body is not itself an error worth reporting */
    }
    throw new ApiError(res.status, path, detail || `${res.status} from ${path}`);
  }
  return (await res.json()) as T;
}
