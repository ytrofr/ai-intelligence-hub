# github-discovery-scoring

> Score GitHub repos for project relevance using weighted dependency/topic matching, then filter the SERVE path (star floor, forks, dedup, recency decay). Use when building recommendation engines, filtering discovery results, or ranking repositories.


# GitHub Discovery Scoring

## WHEN TO USE (Triggers)
1. When ranking discovered GitHub repos by relevance to a project
2. When generic repos (React boilerplates) rank too high in results
3. When building a recommendation engine for code repositories
4. When filtering discovery results by tech stack overlap
5. When scoring needs to distinguish domain-specific from generic matches
6. When the recommendation list is full of repos you already depend on

## FAILED ATTEMPTS
| # | Attempt | Why Failed | Lesson |
|---|---------|-----------|--------|
| 1 | Scored by star count only | Popular generic repos (React templates) outranked niche relevant ones | Stars measure popularity, not relevance |
| 2 | Equal weight for all dependency matches | React/Tailwind matches scored same as google-adk/pgvector | Domain-specific deps need 10x weight vs generic |
| 3 | Keyword matching in description only | Missed repos with relevant dependencies but generic descriptions | Analyze actual dependencies (package.json, requirements.txt) |
| 4 | Treated every non-frontend dep as domain-specific (2026-08-16) | Took TWO tuning rounds to clear. Round 1: dev tooling (`@types/*`, eslint, vitest) scored as key deps. Round 2: the shared AI SDKs (`@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`, `openai`, `@google/genai`, `mcp`) — every project of ours has them, so a match carried ZERO information while reading as a strong signal | A dep shared by ALL your projects is generic BY DEFINITION, no matter how specialised it looks. Fix the CLASS (`GENERIC_DEP_RE` for `@types/*`-style families) not the instance |
| 5 | Served our own declared deps as the recommendation list (the tautology) | Overlap was forced to 10.0 for a project's own deps, so 20/20 "recommended repos" were things already in package.json. It looked like a working feature for months | Own-deps ranking answers a DIFFERENT question — upstream staleness. Relabel it (`stackHealth`, stalest-first) and keep it out of the recommendation list |
| 6 | Filtered only at discovery time, never at serve time | 3-star repos, forks, and mirror duplicates reached the API because nothing re-checked at read time | Discovery-time score ≠ serve-time fitness. Put the floor/fork/dedup/decay in the SERVE path so a stored row can never bypass it |

## CORRECT PATTERN

### Weighted Scoring Formula (discovery time)
```javascript
score = maxOverlap                       // Dependency/topic match weight
      + strategyWeight                   // tech-stack 3.0 · curated 2.5 · rising-stars 2.0
      + Math.min(starVelocity, 10) * 2.0 // Star velocity capped at 20 pts
      + recencyScore * 10.0              // Last push recency x 10
      + readmeQuality * 0.5;             // README length normalized [0,1]

weightedOverlap = specificDeps * 5.0     // google-adk, pgvector, prisma
                + genericDeps * 0.5      // react, tailwind, express, openai
                + specificTopics * 3.0   // agent-framework, rag
                + genericTopics * 0.3;   // ai, llm, open-source
```

### Generic Detection — set AND pattern
```javascript
const GENERIC_DEPS = new Set([
  // frontend / JS tooling
  'react','react-dom','typescript','vite','tailwindcss','next','express','axios','lodash',
  'dotenv','eslint','prettier','jest','vitest','webpack','postcss','zod','cors','helmet',
  // Python backend baseline — "it's a Python backend", not "relevant to this project"
  'fastapi','uvicorn','pydantic','httpx','requests','starlette','aiohttp','click','rich',
  'pyyaml','sqlalchemy','numpy','pandas','pytest','typing-extensions',
  // AI SDKs shared by EVERY project of ours — an AI app, not a domain
  '@modelcontextprotocol/sdk','@anthropic-ai/sdk','anthropic','openai','@google/genai',
  'google-genai','@google/generative-ai','mcp','litellm','tiktoken',
]);
const GENERIC_DEP_RE = /^(@types\/|@eslint\/|@typescript-eslint\/|eslint-|babel-|@babel\/)/;
const isGenericDep = (d) => GENERIC_DEPS.has(d) || GENERIC_DEP_RE.test(d);
```
**Calibration test**: if a dep appears in 3+ of your own projects' profiles, it belongs in this set. Adding one dep at a time is how this took two rounds.

### The SERVE path — `routes/lib/rank.js`
Filters that must run at read time, not only at ingest:
```javascript
starFloor(rows, min = 200)     // ?starsMin= to override, ?raw=1 to bypass entirely
dropForksArchived(rows)        // store fork/archived at discovery so this is possible
canonicalDedup(rows)           // key on repo NAME + a normalized description key (>=20 chars)
recencyFactor(pushedAt)        // x1.0 / 0.7 / 0.45 / 0.25 at 30 / 90 / 180 days
```
`canonicalDedup` on exact title alone does not work: mirrors and re-uploads share a description while differing in owner. Two repos legitimately sharing a short name collapse — that is intended, keep the higher-starred one.

### `stackHealth` — the honest use of own-deps overlap
Rank the project's OWN declared deps by upstream staleness (`pushed_at` ascending) and label it plainly. That is real information: it is how a deprecated-SDK finding surfaced in one of the tracked projects (`google-gemini/deprecated-generative-ai-js`, last push 257 days, still imported by 15 files). It is NOT a recommendation list.

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

### Re-scoring stored rows after a tuning change
Tuning the weights does NOT re-tag rows already in the DB. Ship an offline re-scorer (`scripts/rescore-discovery.js --apply`) and run it after every weight change, or the fix only affects future fetches and the measurement you take is of the old scoring.

## EVIDENCE
| Metric | Value | Source |
|--------|-------|--------|
| Served rows under 200 stars (three projects' top-20) | 6/10/5 -> 0/0/0 | 2026-08-16 audit, before/after |
| Duplicate repos in a served list | 1 pair -> 0 | same |
| "Recommendations" that were our own deps | 20/20 -> 0 (moved to stackHealth) | same |
| Tuning rounds needed to clear generic-dep noise | 2 | same — round 1 dev tooling, round 2 shared AI SDKs |
| API budget used | 80 calls per 6hr cycle (0.7% of limit) | GitHub rate limit logs |

## QUICK START (< 5 minutes)
1. **Define generic sets AND a pattern** (1 min): any dep in 3+ of your projects is generic.
2. **Implement weighted overlap** (2 min): 5.0x specific, 0.5x generic.
3. **Add the serve-path filters** (1 min): star floor, fork/archived, canonical dedup, recency decay — with a `raw=1` bypass so you can always see what was filtered.
4. **Re-score stored rows** after any weight change, then measure.
