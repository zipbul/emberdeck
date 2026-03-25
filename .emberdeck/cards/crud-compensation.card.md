---
{key: crud-compensation,summary: Create/update/delete compensation sequences and CompensationError contract,status: active,type: spec,parent: data-integrity,boundary: [src/ops/create.ts,src/ops/update.ts,src/ops/delete.ts],relations: [data-integrity,concurrency-safety],codeLinks: [{kind: function,file: src/ops/safe.ts,symbol: safeWriteOperation},{kind: function,file: src/ops/create.ts,symbol: createCard},{kind: function,file: src/ops/update.ts,symbol: updateCard},{kind: function,file: src/ops/delete.ts,symbol: deleteCard}],tags: [contract,transaction]}
---
## Contracts
- WHEN create succeeds in DB but file write fails THEN compensate by deleting card from DB
- WHEN update succeeds in DB but file write fails THEN compensate by re-syncing from existing file (syncCardFromFile)
- WHEN delete succeeds in DB but file delete fails THEN compensate by re-syncing from file (syncCardFromFile)
- WHEN compensation itself fails THEN throw CompensationError containing both original and compensation errors
- WHEN CompensationError thrown THEN DB-file inconsistency exists — requires manual intervention
- WHEN any CRUD op called THEN withCardLock serializes concurrent calls for the same key
- WHEN DB transaction used THEN all sub-operations (card row, relations, tags, codeLinks, changelog) are atomic
- WHEN update called with bodyPatches THEN patches are applied sequentially to current body; each old text must appear exactly once at apply time
- WHEN update called with both body and bodyPatches THEN reject (mutually exclusive)

## Failure modes
| Symptom | Cause | Resolution |
|---------|-------|------------|
| CompensationError | DB succeeded, file failed, compensation also failed | Manual: run export_card_to_file or sync_card_from_file to restore consistency |
| Orphan DB row without file | Create compensation failed | Run validate_cards to detect staleDbRows, then manually delete or export |
| File exists but DB row missing | Delete compensation succeeded but original error re-thrown | Run bulk_sync_cards to re-import from file |

## Cross-module contracts
- safeWriteOperation is the single pattern for all write ops — DB first, file second, compensate on file failure
- Delete operation has additional side effects: updates children files (nullify parent) and referencing cards' files (remove from relations) — these are best-effort, not compensated
- Rename uses a different pattern: file move first, DB update second, restore file on DB failure