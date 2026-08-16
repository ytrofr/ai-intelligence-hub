/**
 * HuggingFace Module - Fetch trending models and spaces
 */

const BaseModule = require("./base-module");
const { fetchJson } = require("./http");

class HuggingFaceModule extends BaseModule {
  /**
   * Models + spaces. Sort param comes from config (HF rejects the old
   * "trending" value with 400). Both endpoints failing -> throw; one -> warn.
   */
  async fetch() {
    const sort = this.config.sort || "trendingScore";
    const timeoutMs = this.config.timeout_ms || 20000;
    const modelsUrl = `https://huggingface.co/api/models?sort=${sort}&direction=-1&limit=30`;
    const spacesUrl = `https://huggingface.co/api/spaces?sort=${sort}&direction=-1&limit=20`;

    const [modelsRes, spacesRes] = await Promise.allSettled([
      fetchJson(modelsUrl, { timeoutMs }),
      fetchJson(spacesUrl, { timeoutMs }),
    ]);
    const failures = [modelsRes, spacesRes].filter((r) => r.status === "rejected").map((r) => r.reason.message);
    if (failures.length === 2) throw new Error(`HuggingFace models+spaces failed - ${failures[0]}`);
    if (failures.length) console.warn(`HuggingFace: one endpoint failed: ${failures[0]}`);

    const models = modelsRes.status === "fulfilled" ? modelsRes.value : [];
    const spaces = spacesRes.status === "fulfilled" ? spacesRes.value : [];
    return [...models.map((m) => this.modelItem(m)), ...spaces.map((s) => this.spaceItem(s))];
  }

  modelItem(model) {
    return this.normalize({
      id: `model-${model.id}`,
      title: model.id,
      url: `https://huggingface.co/${model.id}`,
      description: model.pipeline_tag ? `${model.pipeline_tag} model` : "ML Model",
      author: model.author,
      stars: model.downloads || 0,
      score: this.calculateScore(model),
      published_at: model.lastModified,
      metadata: { type: "model", pipeline: model.pipeline_tag, library: model.library_name, likes: model.likes },
    });
  }

  spaceItem(space) {
    return this.normalize({
      id: `space-${space.id}`,
      title: `🚀 ${space.id}`,
      url: `https://huggingface.co/spaces/${space.id}`,
      description: space.sdk ? `${space.sdk} Space` : "HuggingFace Space",
      author: space.author,
      stars: space.likes || 0,
      score: (space.likes || 0) * 10,
      published_at: space.lastModified,
      metadata: { type: "space", sdk: space.sdk, likes: space.likes },
    });
  }

  calculateScore(model) {
    const downloads = model.downloads || 0;
    const likes = model.likes || 0;
    return Math.round(downloads / 100 + likes * 5);
  }
}

module.exports = HuggingFaceModule;
