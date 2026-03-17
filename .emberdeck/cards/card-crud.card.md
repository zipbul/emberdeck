---
{key: card-crud,summary: "Card write operations — create, update, delete, rename with 3-phase commit and FIFO locking",status: draft,type: feature,priority: critical,acceptance: [{id: AC1,description: "createCard atomically writes DB and file, rolls back on partial failure via compensation",verified: false},{id: AC2,description: updateCard supports partial field updates and records changelog for each changed field,verified: false},{id: AC3,description: deleteCard removes DB rows (FK cascade) and file,verified: false},{id: AC4,description: renameCard acquires dual-key sorted locks and propagates via FK CASCADE,verified: false},{id: AC5,description: bulkCreateCards resolves intra-batch relations via two-phase create-then-relate,verified: false}],keywords: [create,update,delete,rename,bulk,atomic,compensation,lock,fifo],tags: [ops,write],relations: [{type: depends-on,target: persistence},{type: depends-on,target: card-io},{type: depends-on,target: card-model}],codeLinks: [{kind: function,file: src/ops/create.ts,symbol: createCard},{kind: function,file: src/ops/bulk-create.ts,symbol: bulkCreateCards},{kind: function,file: src/ops/update.ts,symbol: updateCard},{kind: function,file: src/ops/update.ts,symbol: updateCardStatus},{kind: function,file: src/ops/delete.ts,symbol: deleteCard},{kind: function,file: src/ops/rename.ts,symbol: renameCard},{kind: function,file: src/ops/safe.ts,symbol: safeWriteOperation},{kind: function,file: src/ops/safe.ts,symbol: withCardLock},{kind: function,file: src/ops/safe.ts,symbol: withRetry}]}
---
## Why

All write operations use a "DB-first, file-second" 3-phase commit with compensation. DB-first was chosen because Drizzle transactions provide atomic multi-table updates (relations, keywords, tags, codeLinks, changelog in one shot), while file operations have higher failure surface (permissions, disk space). Rolling back DB via `syncCardFromFile` is cheaper than recreating a missing file.

Concurrency uses per-card FIFO locks (`withCardLock`), not global locks. Different cards can be written in parallel; same-card writes are serialized in arrival order. This was chosen over optimistic locking because card writes are fast (single SQLite transaction + file write) and contention is low in CLI usage. A WeakMap keyed on EmberdeckContext auto-cleans locks when the context is GC'd.

`renameCard` acquires locks on BOTH old and new keys (sorted to prevent deadlock). This is the only operation with dual-key locking.

Bulk create uses a two-phase strategy: Phase 1 creates all cards without relations, Phase 2 applies relations. This ensures intra-batch relations resolve regardless of array order (card A depends-on card B, both in same batch). Phase 2 merges relations per card to prevent mutual overwrites.

Changelog records field-level diffs on every update. Body changes log existence only (`oldValue`/`newValue` both null) to prevent changelog bloat. `changedBy` is hardcoded to `'agent'` — no user model yet.

## Invariants

- After `createCard` succeeds: file + DB row + relations + keywords + tags + codeLinks all exist, or none do.
- After `deleteCard` succeeds: file deleted, DB cascade cleans all child records.
- `createCard` rejects empty acceptance criteria — a card without completion conditions is unmeasurable.
- `renameCard` uses FK CASCADE to propagate key changes to all referencing tables.
- `withRetry` retries only SQLITE_BUSY errors (exponential backoff: 50ms base, 2s max, 3 attempts). Non-busy errors fail immediately.

## Scope Boundaries

- Does NOT implement auto-merge for concurrent updates — last write wins within the FIFO queue.
- Does NOT cascade-delete dependent cards — only the reference (relation row) is removed by FK CASCADE.
- Does NOT garbage-collect changelog entries — grows unbounded.
- Does NOT validate acceptance criterion IDs against existing criteria in `verifyAcceptance`.
- `bulkCreateCards` provides partial success — failed cards are skipped, successful ones kept.

## Edge Cases

- File exists but DB doesn't on create: file check happens first, throws `CardAlreadyExistsError` before DB check.
- DB succeeds but file write fails: compensation deletes the DB row (create) or re-syncs from file (update/delete).
- Both file AND compensation fail: throws `CompensationError(fileErr, compensationErr)` — signals unrecoverable state.
- Rename to same slug: throws `CardRenameSamePathError` (no-op prevention).
- Bulk create with inter-batch relations where target fails: relation is skipped silently (FK violation catch).