/**
 * HuggingFace Module - Fetch trending models and spaces
 */

const BaseModule = require("./base-module");

class HuggingFaceModule extends BaseModule {
  async fetch() {
    const items = [];

    // Fetch trending models
    try {
      const modelsUrl =
        "https://huggingface.co/api/models?sort=trending&limit=30";
      const modelsRes = await fetch(modelsUrl, {
        headers: { "User-Agent": "AI-Intelligence-Hub/1.0" },
      });

      if (modelsRes.ok) {
        const models = await modelsRes.json();
        for (const model of models) {
          items.push(
            this.normalize({
              id: `model-${model.id}`,
              title: model.id,
              url: `https://huggingface.co/${model.id}`,
              description: model.pipeline_tag
                ? `${model.pipeline_tag} model`
                : "ML Model",
              author: model.author,
              stars: model.downloads || 0,
              score: this.calculateScore(model),
              published_at: model.lastModified,
              metadata: {
                type: "model",
                pipeline: model.pipeline_tag,
                library: model.library_name,
                likes: model.likes,
              },
            }),
          );
        }
      }
    } catch (err) {
      console.error("HuggingFace models fetch error:", err.message);
    }

    // Fetch trending spaces
    try {
      const spacesUrl =
        "https://huggingface.co/api/spaces?sort=trending&limit=20";
      const spacesRes = await fetch(spacesUrl, {
        headers: { "User-Agent": "AI-Intelligence-Hub/1.0" },
      });

      if (spacesRes.ok) {
        const spaces = await spacesRes.json();
        for (const space of spaces) {
          items.push(
            this.normalize({
              id: `space-${space.id}`,
              title: `🚀 ${space.id}`,
              url: `https://huggingface.co/spaces/${space.id}`,
              description: space.sdk
                ? `${space.sdk} Space`
                : "HuggingFace Space",
              author: space.author,
              stars: space.likes || 0,
              score: (space.likes || 0) * 10,
              published_at: space.lastModified,
              metadata: {
                type: "space",
                sdk: space.sdk,
                likes: space.likes,
              },
            }),
          );
        }
      }
    } catch (err) {
      console.error("HuggingFace spaces fetch error:", err.message);
    }

    return items;
  }

  calculateScore(model) {
    const downloads = model.downloads || 0;
    const likes = model.likes || 0;
    return Math.round(downloads / 100 + likes * 5);
  }
}

module.exports = HuggingFaceModule;
