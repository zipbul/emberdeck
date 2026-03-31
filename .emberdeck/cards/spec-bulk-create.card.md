---
{key: spec-bulk-create,summary: bulkCreateCards topologically sorts by parent dependency and applies relations in a second phase,status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/bulk-create.ts],codeLinks: [{kind: function,file: src/ops/bulk-create.ts,symbol: bulkCreateCards}],glossary: [card],relations: [card-lifecycle,spec-create-card]}
---

## Contracts
- WHEN bulkCreateCards is called, THEN cards MUST be topologically sorted so parents are created before children.
- WHEN creating cards, THEN relations MUST be stripped in phase 1 and applied via updateCard in phase 2, ensuring intra-batch relation targets exist.
- WHEN a card creation fails, THEN remaining cards MUST continue (partial success). Failed keys are reported in errors array.
- WHEN a relation update fails after successful creation, THEN the card key MUST move from keys to partialKeys.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Circular parent references in batch | Unresolvable cards appended at end (may fail) |
| Single card creation fails | Error recorded, remaining cards continue |
| Relation update fails | Card exists in DB but without intended relations (partialKeys) |
