---
{key: spec-rename-card,summary: "renameCard moves file, updates DB key via FK cascade, and propagates to referencing cards",status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/rename.ts],codeLinks: [{kind: function,file: src/ops/rename.ts,symbol: renameCard}],glossary: [card,dual storage],relations: [card-lifecycle,spec-safe-write]}
---

## Contracts
- WHEN renameCard is called, THEN both keys (old and new) MUST be locked in alphabetical order to prevent deadlocks.
- WHEN the rename proceeds, THEN the file MUST be moved first (OS rename), then frontmatter key updated, then DB key UPDATE with FK cascade.
- WHEN the DB UPDATE fails after file move, THEN the file MUST be restored to its original path and state.
- WHEN other cards reference the old key in parent or relations fields, THEN their files MUST be updated to the new key (best-effort).
- WHEN other cards mention the old key in body text, THEN those keys MUST be returned in bodyReferencesFound for manual update.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Source and target paths identical | CardRenameSamePathError |
| Source card not found | CardNotFoundError |
| Target key already exists | CardAlreadyExistsError |
| DB update fails after file move | File restored to original path |
| Referencing card file update fails | Key added to failedReferenceUpdates array |
