---
{key: analysis,summary: "Impact analysis, drift scoring, acceptance tracking, context generation, regression guard",status: draft,type: feature,priority: medium,acceptance: [{id: AC1,description: preChangeCheck identifies affected cards and at-risk AC with currentlyVerified flag,verified: false},{id: AC2,description: "checkDrift calculates weighted 0-1 score, exempting draft/accepted cards from broken link counting",verified: false},{id: AC3,description: regressionGuard returns pass/warn/fail verdict combining link health and Firebat results,verified: false},{id: AC4,description: verifyAcceptance toggles criterion verified flag and records changelog,verified: false},{id: AC5,description: checkInteractions reports sharedFiles and sharedSymbols between card pairs,verified: false}],keywords: [impact,drift,regression,acceptance,context,interactions,risk],tags: [ops,analysis],relations: [{type: depends-on,target: card-queries},{type: depends-on,target: code-links},{type: depends-on,target: persistence}],codeLinks: [{kind: function,file: src/ops/impact.ts,symbol: preChangeCheck},{kind: function,file: src/ops/impact.ts,symbol: regressionGuard},{kind: function,file: src/ops/context.ts,symbol: generateContext},{kind: function,file: src/ops/context.ts,symbol: checkDrift},{kind: function,file: src/ops/context.ts,symbol: checkInteractions},{kind: function,file: src/ops/acceptance.ts,symbol: verifyAcceptance},{kind: function,file: src/ops/acceptance.ts,symbol: listUnverified}]}
---
## Why

These are higher-order operations that consume the primitive operations (queries, code links) to answer planning questions: "what will this change break?", "how stale are my specs?", "what's left to verify?".

Drift score uses a weighted formula: `brokenLinks*0.3 + staleCards*0.3 + unverifiedAC*0.2 + missingLinks*0.2`. Broken links and stale cards each get 0.3 because they represent active regression risk — code has changed. Unverified acceptance gets 0.2 because it's spec debt, not active regression. `missingLinkRatio` is always 0 (reserved for future @spec auto-detection). Draft/accepted cards are exempt from broken link counting because their code doesn't exist yet.

`preChangeCheck` reports ALL acceptance criteria on affected cards (both verified and unverified) with a `currentlyVerified` flag. Previously it only reported verified AC, making it impossible to know which unverified criteria might be satisfied by the change. Risk elevation to "high" only happens for verified regressions — unverified AC alone stays "medium".

`checkInteractions` detects shared files between card pairs via an explicit `sharedFiles` array, separate from `sharedSymbols`. Cards linking to the same file but different symbols indicates architectural coupling even without symbol overlap.

`regressionGuard` accepts Firebat scan results as-is (unknown type, parsed internally). This avoids coupling to Firebat's schema — the guard adapts to whatever format is passed.

## Invariants

- Drift score range: 0.0 (fully synchronized) to 1.0 (completely stale), rounded to 2 decimals.
- Risk levels: `critical` (affected card has priority=critical) > `high` (3+ direct cards OR verified AC at risk) > `medium` (1-2 direct cards) > `low` (only transitive dependents).
- `generateContext` BFS maxDepth defaults to 3. Only root card's body is included when `includeBody=true`.
- `verifyAcceptance` flips the `verified` flag on criteria — does NOT validate criterion IDs against the card's actual criteria list.
- `listUnverified` returns cards with at least one `verified: false` criterion.

## Scope Boundaries

- Does NOT auto-verify acceptance criteria — agent must explicitly call `verifyAcceptance`.
- Does NOT run tests or execute code — purely static analysis of card/link state.
- Does NOT garbage-collect changelog — history grows unbounded.
- Does NOT provide incremental drift — always recalculates from full state.
- `regressionGuard` does NOT validate Firebat report structure — tolerates any shape.
- `checkInteractions` does NOT analyze import/dependency graphs — only codeLink overlap.

## Edge Cases

- `preChangeCheck` with no affected cards: returns `riskLevel: 'low'`, empty arrays.
- `checkDrift` with no cards at all: returns `{ driftScore: 0, summary: 'No cards found.' }`.
- `checkDrift` with gildash not configured: broken link counting skipped entirely (graceful degradation).
- `generateContext` for nonexistent card: throws Error.
- `regressionGuard` with string/number as firebatReport: treated as no issues (graceful).
- `checkInteractions` with empty card list: returns empty interactions and undefinedRelations.