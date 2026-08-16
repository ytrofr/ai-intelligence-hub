/**
 * HTTP helpers - the ONE place upstream fetches get a timeout and honest errors.
 *
 * Node 24 built-ins only (AbortSignal.timeout) - no dependency.
 * Every helper THROWS on !res.ok (HttpError with .status) and on timeout
 * (DOMException name "TimeoutError"); modules must not swallow these -
 * routes/fetch.js turns them into per-source status + errors[].
 */

const DEFAULT_TIMEOUT_MS = 15000;
const USER_AGENT = "AI-Intelligence-Hub/1.0";

class HttpError extends Error {
  constructor(status, url, bodySnippet) {
    super(`HTTP ${status} for ${url}${bodySnippet ? `: ${bodySnippet}` : ""}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

async function fetchResponse(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, method = "GET", body, redirect } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      body,
      // redirect:"manual" lets a caller SEE a 301 instead of silently following
      // it — the tracker needs that to tell "renamed" from "fine".
      ...(redirect ? { redirect } : {}),
      headers: { "User-Agent": USER_AGENT, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err && err.name === "TimeoutError") {
      const e = new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      e.name = "TimeoutError";
      throw e;
    }
    throw err;
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ");
    const err = new HttpError(res.status, url, snippet);
    // A 3xx carries its destination in a header; losing it makes "it moved"
    // unactionable for any caller that asked to see redirects.
    err.location = res.headers.get("location");
    throw err;
  }
  return res;
}

async function fetchJson(url, opts = {}) {
  const res = await fetchResponse(url, { ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) } });
  return res.json();
}

async function fetchText(url, opts = {}) {
  const res = await fetchResponse(url, opts);
  return res.text();
}

module.exports = { fetchResponse, fetchJson, fetchText, HttpError, DEFAULT_TIMEOUT_MS };
