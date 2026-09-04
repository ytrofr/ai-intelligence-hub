/**
 * HuggingFace probe for tracked rows whose `kind` is `model` or `dataset`.
 *
 * H2 fix (2026-09): modules/tracked-repos.js asked api.github.com about EVERY
 * tracked row, regardless of kind. A HuggingFace id is spelled exactly like a
 * GitHub slug ("owner/name"), so a live HF model 404s against GitHub and the
 * weekly digest reported it "DELETED" while it was sitting on HF returning
 * 200 the whole time. This module is the other host tracked-repos.js can ask.
 *
 * Same shape a GitHub repo() call returns, so tracked-repos.js's diff logic
 * (tracker-diff.js) never has to know which host answered:
 *   {status, body: {archived, pushed_at, stargazers_count, description, full_name}}
 *
 * HF has no GitHub-style "latest release" concept, so a caller must not
 * follow this up with a release lookup - see the `viaHf` marker this module's
 * caller (tracked-repos.js probeByKind) attaches to the result.
 */

const { fetchResponse } = require("./http");

const HF_API = "https://huggingface.co/api";

function endpointFor(kind) {
  return kind === "dataset" ? "datasets" : "models";
}

/**
 * HF's `disabled` flag is the closest real equivalent to GitHub's `archived` -
 * both mean "still exists, no longer live". Never invented: a model with no
 * such field simply reads as not archived, same as GitHub's `archived: false`.
 */
function toGhShape(hfBody) {
  if (!hfBody) return null;
  return {
    full_name: hfBody.id || hfBody.modelId || null,
    archived: hfBody.disabled === true,
    pushed_at: hfBody.lastModified || null,
    stargazers_count: Number.isFinite(hfBody.likes) ? hfBody.likes : null,
    description: (hfBody.cardData && hfBody.cardData.summary) || hfBody.pipeline_tag || null,
  };
}

function hfClient({ timeoutMs = 15000 } = {}) {
  const call = async (kind, id) => {
    const url = `${HF_API}/${endpointFor(kind)}/${id}`;
    try {
      const res = await fetchResponse(url, { timeoutMs });
      const body = await res.json().catch(() => null);
      return { status: res.status, body: toGhShape(body) };
    } catch (err) {
      if (Number.isFinite(err && err.status)) return { status: err.status, body: null };
      throw err;
    }
  };

  return {
    probe: (id, kind) => call(kind === "dataset" ? "dataset" : "model", id),
    model: (id) => call("model", id),
    dataset: (id) => call("dataset", id),
  };
}

module.exports = { hfClient, toGhShape, HF_API };
