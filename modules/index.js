/**
 * Module Registry - Maps source types to module classes
 */

const GitHubModule = require("./github");
const HuggingFaceModule = require("./huggingface");
const RSSModule = require("./rss");
const MCPRegistryModule = require("./mcp-registry");
const ChangelogModule = require("./changelog");

const moduleTypes = {
  github: GitHubModule,
  huggingface: HuggingFaceModule,
  rss: RSSModule,
  mcp: MCPRegistryModule,
  changelog: ChangelogModule,
};

function createModule(sourceConfig) {
  const ModuleClass = moduleTypes[sourceConfig.type];
  if (!ModuleClass) {
    console.warn(`Unknown module type: ${sourceConfig.type}`);
    return null;
  }
  return new ModuleClass(sourceConfig);
}

module.exports = { createModule, moduleTypes };
