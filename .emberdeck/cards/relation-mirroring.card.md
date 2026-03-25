---
{key: relation-mirroring,summary: Bidirectional relation storage and mirroring contract,status: active,type: spec,parent: card-model,codeLinks: [{kind: class,file: src/db/relation-repo.ts,symbol: DrizzleRelationRepository},{kind: function,file: src/card/validation.ts,symbol: validateRelationTargets}],tags: [contract],relations: [card-model]}
---
## Contracts
- WHEN relation A→B created THEN reverse entry B→A (isReverse=true) is automatically created in DB
- WHEN replaceForCard(A, [B,C]) called THEN all previous forward relations from A are deleted, new forward + reverse entries created atomically
- WHEN self-reference (A→A) attempted THEN reject with CardValidationError
- WHEN relation target does not exist in DB THEN reject with CardValidationError
- WHEN card A is deleted THEN all relations involving A (both forward and reverse) cascade-deleted via FK

## Cross-module contracts
- Frontmatter shows only forward relations; reverse entries are DB-only (never serialized to file)
- Backward graph traversal (used by preChangeCheck, getRelationGraph) depends on reverse entries existing — if mirroring breaks, impact analysis misses dependencies
- replaceForCard handles mirroring automatically — callers never manage reverse entries directly
- Delete operation: after cascade-deleting relations in DB, updates referencing cards' files (removes this key from their relations array) as best-effort