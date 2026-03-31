---
{key: spec-delete-card,summary: deleteCard removes card from DB and file with force mode for parent cards and bidirectional cleanup,status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/delete.ts],codeLinks: [{kind: function,file: src/ops/delete.ts,symbol: deleteCard}],glossary: [card,dual storage,compensation],relations: [card-lifecycle,spec-safe-write]}
---

## Contracts
- WHEN deleteCard is called without force and the card has children, THEN CardValidationError MUST be thrown.
- WHEN deleteCard is called with force=true and the card has children, THEN children MUST become orphans (parent set to null in both DB via FK cascade and files via best-effort update).
- WHEN deleteCard succeeds, THEN referencing cards' relation fields MUST be updated (best-effort) to remove the deleted key.
- WHEN the card file has been externally deleted, THEN DB cleanup MUST still proceed (guard on DB existence, not file).
- WHEN file delete fails after DB delete, THEN compensation re-syncs the card from file if the file still exists.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Has children, force=false | CardValidationError with child count |
| Card not in DB | CardNotFoundError |
| File delete fails after DB delete | Compensation re-syncs from file |
| Child file update fails | Best-effort skip (child exists without parent field) |
| Referencing card file update fails | Best-effort skip |
