---
{key: parent-child-hierarchy,summary: "Parent-child type rules, cycle prevention, and cascade behavior",status: active,type: spec,parent: card-model,boundary: [src/card/validation.ts],codeLinks: [{kind: function,file: src/card/validation.ts,symbol: validateParentExists},{kind: function,file: src/card/validation.ts,symbol: validateParentCycle},{kind: function,file: src/card/validation.ts,symbol: validateParentType},{kind: function,file: src/card/validation.ts,symbol: validateChildrenHierarchy}],tags: [contract,hierarchy],relations: [card-model]}
---
## Contracts
- WHEN intent card has parent THEN parent must be intent (not spec)
- WHEN spec card has parent THEN parent must be intent or spec
- WHEN parent key does not exist in DB THEN reject with ParentValidationError
- WHEN parent chain forms a cycle THEN reject (detected via ancestor walk, max depth 20)
- WHEN ancestor walk exceeds depth 20 THEN assume safe (no cycle) — tradeoff: extremely deep hierarchies pass
- WHEN card type changes to spec THEN reject if any child is intent (intent cannot have spec parent)
- WHEN parent card is deleted with force=true THEN children's parent field is set to null (FK SET NULL)
- WHEN parent card is renamed THEN children's parent field is updated automatically (FK CASCADE UPDATE)

## Failure modes
| Symptom | Cause | Resolution |
|---------|-------|------------|
| ParentValidationError on valid-looking parent | Parent was deleted between validation and write | Retry — concurrent deletion race condition |
| Deep hierarchy (>20) with undetected cycle | Cycle detection cap at 20 | Manual inspection; extremely unlikely in practice |

## Cross-module contracts
- Delete operation: when force=true, updates children's files (removes parent field) as best-effort after DB cascade
- Rename operation: FK CASCADE UPDATE propagates new key to children in DB; files updated separately
- validateChildrenHierarchy prevents type changes that would break existing children's type rules