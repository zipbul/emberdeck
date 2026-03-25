---
{key: bulk-create-two-phase,summary: Topological sort and two-phase relation application for bulk creation,status: active,type: spec,parent: data-integrity,codeLinks: [{kind: function,file: src/ops/bulk-create.ts,symbol: bulkCreateCards}],tags: [contract],relations: [data-integrity,crud-compensation]}
---
## Contracts
- WHEN bulk create called THEN cards are topologically sorted by parent dependency (parents created first)
- WHEN Phase 1 completes THEN all cards exist in DB without relations
- WHEN Phase 2 runs THEN relations are applied to successfully created cards, resolving intra-batch references
- WHEN a card fails in Phase 1 THEN it is skipped, remaining cards continue (partial success)
- WHEN a card fails in Phase 1 THEN its relations are not applied in Phase 2
- WHEN input order is arbitrary THEN topological sort ensures parents exist before children regardless

## Failure modes
| Symptom | Cause | Resolution |
|---------|-------|------------|
| Partial creation (some succeed, some fail) | Bad parent reference, validation error, or file write failure | Check returned errors array, retry failed subset |
| Relations missing on successfully created cards | Relation target was in the failed subset | Manually add relations after fixing and recreating failed cards |

## Cross-module contracts
- Each card in Phase 1 goes through the full createCard path (validation, safeWriteOperation)
- Phase 2 uses updateCard to apply relations, so all relation validation rules (no self-reference, target must exist) still apply