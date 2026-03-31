---
{key: spec-analyze,summary: "analyze combines drift detection, coverage, and glossary stats into a single project health report",status: draft,type: spec,parent: drift-detection,boundary: [src/ops/analyze.ts],codeLinks: [{kind: function,file: src/ops/analyze.ts,symbol: analyze},{kind: function,file: src/ops/analyze.ts,symbol: getOnboardingSummary}],glossary: [card,drift,gildash],relations: [drift-detection]}
---

## Contracts
- WHEN analyze is called, THEN it MUST combine: checkDrift (read-only, autoTransition=false) for health/drift, getUncoveredSymbols for coverage, and readGlossary for glossary stats.
- WHEN a card has driftType detected by checkDrift, THEN it MUST count as drifted regardless of DB status. When no driftType but DB status=drifted, it MUST still count as drifted.
- WHEN offset/limit are provided, THEN driftedCards array MUST be sliced accordingly, but driftedCardsTotal MUST always reflect the unsliced count.
- WHEN getOnboardingSummary is called, THEN it MUST return card counts by type/status, hierarchy tree (max 3 levels), coverage ratio, drifted card summaries, and relation count.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Gildash unavailable | Coverage returns 0/0/1, unlinkedSymbols empty |
| No cards exist | All health counts 0, empty hierarchy |
