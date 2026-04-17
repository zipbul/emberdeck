---
{key: drift-detection/impact-analysis,summary: Pre-change impact analysis with direct/boundary/transitive card discovery and regression guard,status: draft,type: spec,parent: drift-detection,boundary: [src/ops/impact.ts,src/ops/query.ts],relations: [drift-detection,drift-detection/check-drift],codeLinks: [{kind: function,file: src/ops/impact.ts,symbol: preChangeCheck},{kind: function,file: src/ops/impact.ts,symbol: regressionGuard}],glossary: [drift,boundary]}
---

## Contract
- GIVEN a list of files to be changed
  WHEN preChangeCheck is called
  THEN cards with code links to those files MUST be returned as direct affected cards.
- GIVEN a list of files to be changed
  WHEN preChangeCheck is called and cards have boundary patterns matching those files
  THEN those cards MUST be returned as boundary affected cards.
- GIVEN direct and boundary affected cards exist
  WHEN preChangeCheck performs BFS backward traversal (max depth 3)
  THEN transitively dependent cards MUST be returned with via field indicating the source.
- GIVEN affected cards are collected
  WHEN risk level is calculated
  THEN 5+ affected or >50% drifted = critical, 3+ or >25% drifted = high, 1+ = medium, 0 = low.
- GIVEN changed files and a regression threshold
  WHEN regressionGuard is called
  THEN if the drifted ratio among affected cards exceeds the threshold, the result MUST be fail.

## Invariant
- preChangeCheck MUST always return the full project glossary in the result for agent context.
- Risk level calculation MUST consider both card count AND drifted ratio — either condition triggers escalation.
- regressionGuard with 0 affected cards MUST always return pass.
- Files matching ignorePatterns MUST be excluded from uncovered files list.

## Failure
| Violation | System behavior |
|-----------|----------------|
| No cards reference the changed files | Result has 0 affected cards, risk level low |
| Symbol index unavailable | Code link matching skipped; boundary matching still works |
| Boundary pattern invalid | Pattern skipped during matching |
| Regression threshold is 0 and any card is drifted | regressionGuard returns fail |
| checkDrift fails for a specific card | That card's drift status falls back to DB status |
