---
{key: analysis,summary: "Analysis operations: context generation, drift detection, interaction analysis, impact assessment, and regression guards",status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: "generateContext BFS-traverses the relation graph from a root card, collecting summaries, acceptance criteria, code links, recent changes, and constraints into a ContextPack.",verified: true},{id: ac-2,description: "generateContext defaults: maxCards=20, maxDepth=3, includeBody=false. Body is only included for the root card when opted in.",verified: true},{id: ac-3,description: "checkDrift produces a 0-1 drift score using weighted formula: brokenLinkRatio*0.3 + staleCardRatio*0.3 + unverifiedRatio*0.2 + missingLinkRatio*0.2.",verified: true},{id: ac-4,description: "checkDrift operates on a single card's graph or all cards (when fullKey is omitted).",verified: true},{id: ac-5,description: "checkInteractions detects shared symbols, shared files, existing relations, and potential conflicts between card pairs.",verified: true},{id: ac-6,description: "preChangeCheck finds directly affected cards (via code links) and transitively affected cards (via backward BFS), then identifies at-risk acceptance criteria.",verified: true},{id: ac-7,description: "regressionGuard combines changed file analysis with optional Firebat report, producing a quality gate (pass/warn/fail).",verified: true},{id: ac-8,description: "Risk level calculation: critical if any affected card has critical priority, high if 3+ direct cards or verified acceptance at risk, medium if 1+ direct, low otherwise.",verified: true}],keywords: [generateContext,checkDrift,checkInteractions,preChangeCheck,regressionGuard,ContextPack,DriftResult],tags: [operations,analysis,impact],relations: [{type: depends-on,target: card-queries},{type: depends-on,target: code-links},{type: depends-on,target: persistence}],codeLinks: [{kind: function,file: src/ops/context.ts,symbol: generateContext},{kind: function,file: src/ops/context.ts,symbol: checkDrift},{kind: function,file: src/ops/context.ts,symbol: checkInteractions},{kind: function,file: src/ops/impact.ts,symbol: preChangeCheck},{kind: function,file: src/ops/impact.ts,symbol: regressionGuard}]}
---
## Rationale

Analysis operations compose lower-level queries and code link data into actionable insights. They exist as a separate layer because:

- They read from multiple data sources (cards, relations, code links, changelog, gildash)
- They produce derived metrics (drift scores, risk levels) not stored anywhere
- They are the primary interface for AI agents making decisions about what to change

### generateContext: Why a ContextPack?

AI agents need a compact, structured snapshot of related specs before making changes. Rather than forcing the agent to make 5+ separate calls, `generateContext` assembles everything into one pack. The 20-card limit prevents context window overflow.

### checkDrift: Why a Weighted Score?

A single 0-1 number is easier for automated workflows to threshold on than multiple boolean flags. The weights reflect relative importance:
- Broken links and stale cards (0.3 each) are the strongest drift signals
- Unverified acceptance (0.2) is important but may be intentional during active development
- Missing link ratio (0.2) is reserved for Phase 2 auto-detection and currently always 0

### preChangeCheck + regressionGuard: Two-Phase Impact

`preChangeCheck` is called BEFORE making changes (planning phase). `regressionGuard` is called AFTER changes with optional Firebat static analysis results. This separation allows the agent to:
1. Assess risk before writing code
2. Validate quality after writing code

## Key Invariants

- **Drift without gildash**: When gildash is not configured, broken link counting is skipped entirely. The drift score only reflects acceptance health and stale card ratio. This is graceful degradation, not an error.
- **Stale detection**: A card is "stale" when any of its linked files has a modification time after the card's `updatedAt` timestamp. This uses gildash's `getFileInfo` for mtime.
- **Interaction analysis is O(n^2)**: It checks all pairs of input cards. This is acceptable because the typical input is a small set (5-10 cards from a BFS).
- **Firebat integration is loosely coupled**: `regressionGuard` accepts `unknown` for the Firebat report and parses it defensively. This avoids a hard dependency on Firebat's schema.

## Scope Boundaries

- Analysis operations are read-only. They never mutate cards or the database.
- `verifyAcceptance`, `listUnverified`, and `getCardHistory` (in acceptance.ts) are related but simpler — they query acceptance state without computing derived metrics.
