---
{key: spec-regression-guard,summary: regressionGuard checks drifted ratio among affected cards against configurable threshold,status: draft,type: spec,parent: impact-analysis,boundary: [src/ops/impact.ts],codeLinks: [{kind: function,file: src/ops/impact.ts,symbol: regressionGuard}],glossary: [card,drift],relations: [impact-analysis,spec-pre-change]}
---

## Contracts
- WHEN regressionGuard is called, THEN preChangeCheck MUST be used to find affected cards, and fresh drift detection (checkDrift with autoTransition=false) MUST run on each.
- WHEN 0 cards are affected, THEN the guard MUST pass with driftedRatio=0.
- WHEN driftedRatio exceeds the threshold, THEN passOrFail MUST be 'fail'. Otherwise 'pass'.
- WHEN a card has driftType detected OR DB status=drifted, THEN it MUST count toward driftedCount.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| No affected cards | Pass with ratio=0 |
| Card not found during drift check | Status defaults to 'draft' |
