---
{key: dual-storage/bulk-create,summary: Topological sort for parent-first ordering and two-phase creation (cards then relations) with partial success,status: draft,type: spec,parent: dual-storage,boundary: [src/ops/bulk-create.ts],codeLinks: [{kind: function,file: src/ops/bulk-create.ts,symbol: bulkCreateCards},{kind: function,file: src/ops/bulk-create.ts,symbol: topologicalSort}],glossary: [dual-storage],relations: [dual-storage,dual-storage/card-crud]}
---

## Contract
- GIVEN a batch of card inputs with parent-child dependencies
  WHEN bulkCreateCards is called
  THEN inputs MUST be topologically sorted so parents are created before children.
- GIVEN a sorted batch
  WHEN phase 1 runs
  THEN all cards MUST be created without relations first (relations stripped from input).
- GIVEN all cards are created in phase 1
  WHEN phase 2 runs
  THEN relations MUST be applied via updateCard for each card that declared relations.
- GIVEN a card fails during phase 1
  WHEN subsequent cards are processed
  THEN processing MUST continue (partial success) and the failed card MUST be reported in errors.
- GIVEN a relation update fails in phase 2
  WHEN the card was already created in phase 1
  THEN the card key MUST be moved from keys to partialKeys and the error reported.

## Invariant
- Cards without parents (or with parents outside the batch) MUST be created first.
- Circular parent references within a batch MUST NOT cause infinite loops — unresolvable cards are appended at the end.
- Phase 2 relation updates MUST use the standard updateCard path (not direct DB manipulation).

## Failure
| Violation | System behavior |
|-----------|----------------|
| Card creation fails in phase 1 | Error recorded; other cards continue |
| Relation update fails in phase 2 | Card moved to partialKeys; error recorded |
| Circular parent within batch | Cards appended after resolved ones; parent validation may fail |
| Duplicate key in batch | Second card fails with CardAlreadyExistsError |
