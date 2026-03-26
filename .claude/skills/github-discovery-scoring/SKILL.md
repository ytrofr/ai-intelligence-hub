---
name: github-discovery-scoring
description: "Score GitHub repos for project relevance using weighted dependency/topic matching. Use when building recommendation engines, filtering discovery results, or ranking repositories."
user-invocable: false
---

# GitHub Discovery Scoring

## WHEN TO USE (Triggers)
1. When ranking discovered GitHub repos by relevance to a project
2. When generic repos (React boilerplates) rank too high in results
3. When building a recommendation engine for code repositories
4. When filtering discovery results by tech stack overlap
5. When scoring needs to distinguish domain-specific from generic matches

## FAILED ATTEMPTS
| # | Attempt | Why Failed | Lesson |
|---|---------|-----------|--------|
| 1 | Scored by star count only | Popular generic repos (React templates) outranked niche relevant ones | Stars measure popularity, not relevance |
| 2 | Equal weight for all dependency matches | React/Tailwind matches scored same as google-adk/pgvector | Domain-specific deps need 10x weight vs generic |
| 3 | Keyword matching in description only | Missed repos with relevant dependencies but generic descriptions | Analyze actual dependencies (package.json, requirements.txt) |

## CORRECT PATTERN

### Weighted Scoring Formula
```javascript
score = maxOverlap                       // Dependency/topic match weight
      + strategyWeight                   // Strategy bias (tech-stack: 3.0, curated: 2.5, rising-stars: 2.0)
      + Math.min(starVelocity, 10) * 2.0 // Star velocity capped at 20 pts
      + recencyScore * 10.0              // Last push recency x 10
      + readmeQuality * 0.5;             // README length normalized [0,1]

// Weighted overlap: domain-specific >> generic
weightedOverlap = specificDeps * 5.0     // google-adk, pgvector, fastapi
                + genericDeps * 0.5      // react, tailwind, express
                + specificTopics * 3.0   // agent-framework, rag
                + genericTopics * 0.3;   // ai, llm, open-source
```

### Generic Detection
```javascript
const GENERIC_DEPS = new Set([
  'react', 'react-dom', 'typescript', 'vite', 'tailwindcss',
  'express', 'axios', 'lodash', 'dotenv', 'eslint', 'prettier',
  'jest', 'vitest', 'webpack', 'postcss', 'zod', 'cors',
]);

const BROAD_TOPICS = new Set([
  'ai', 'llm', 'agent', 'open-source', 'typescript', 'react',
  'python', 'javascript', 'machine-learning', 'api', 'cli',
]);
```

### Recency Multiplier
```javascript
function getRecencyMultiplier(lastPush) {
  const days = (Date.now() - new Date(lastPush)) / 86400000;
  if (days < 1) return 1.0;
  if (days < 7) return 0.9;
  if (days < 30) return 0.7;
  if (days < 90) return 0.5;
  return 0.3;
}
```

## EVIDENCE
| Metric | Value | Source |
|--------|-------|--------|
| False positive reduction | ~70% fewer generic repos in top results | Hub production |
| Domain-specific repo ranking | Top 3 consistently relevant | 5-project testing |
| API budget used | 80 calls per 6hr cycle (0.7% of limit) | GitHub rate limit logs |

## QUICK START (< 5 minutes)
1. **Define generic sets** (1 min): List common deps/topics to downweight
2. **Implement weighted overlap** (2 min): 5.0x specific, 0.5x generic
3. **Add recency multiplier** (1 min): Favor recently active repos
4. **Test** (1 min): Score known-relevant repo vs known-generic, verify ranking
