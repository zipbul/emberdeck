---
{key: card-crud,summary: "Card CRUD operations with atomic DB+file writes, concurrency locks, and compensation rollback",status: draft,type: decision,priority: critical,acceptance: [{id: ac-1,description: createCard requires acceptance criteria (non-empty). Cards without completion conditions are rejected.,verified: true},{id: ac-2,description: All mutations follow DB-first-then-file pattern via safeWriteOperation.,verified: true},{id: ac-3,description: "If file write fails after DB commit, compensation deletes the DB row (rollback).",verified: true},{id: ac-4,description: "If compensation itself fails, CompensationError is thrown with both original and compensation errors.",verified: true},{id: ac-5,description: Concurrent writes to the same card key are serialized via withCardLock (FIFO per ctx+key).,verified: true},{id: ac-6,description: "SQLite BUSY errors are retried with exponential backoff (default 3 retries, 50ms base, 2s max).",verified: true},{id: ac-7,description: New cards always start in draft status regardless of input.,verified: true},{id: ac-8,description: Relation types are validated against ctx.allowedRelationTypes before any DB write.,verified: true},{id: ac-9,description: renameCard atomically moves the file and updates all relation references (both src and dst).,verified: true},{id: ac-10,description: "bulkCreateCards processes cards sequentially, returning partial results on failure.",verified: true}],keywords: [createCard,updateCard,deleteCard,renameCard,safeWriteOperation,withCardLock,withRetry,compensation],tags: [core,operations],relations: [{type: depends-on,target: card-model},{type: depends-on,target: persistence}],codeLinks: [{kind: function,file: src/ops/create.ts,symbol: createCard},{kind: function,file: src/ops/update.ts,symbol: updateCard},{kind: function,file: src/ops/update.ts,symbol: updateCardStatus},{kind: function,file: src/ops/delete.ts,symbol: deleteCard},{kind: function,file: src/ops/rename.ts,symbol: renameCard},{kind: function,file: src/ops/bulk-create.ts,symbol: bulkCreateCards},{kind: function,file: src/ops/safe.ts,symbol: safeWriteOperation},{kind: function,file: src/ops/safe.ts,symbol: withCardLock},{kind: function,file: src/ops/safe.ts,symbol: withRetry}]}
---
## Rationale

Every card mutation must maintain consistency between the SQLite database and the filesystem. The `safeWriteOperation` pattern was chosen over two-phase commit because:

- SQLite transactions are synchronous in Bun (no async needed for DB writes)
- File I/O is inherently async and can fail independently
- Compensation (delete DB row on file failure) is simpler than two-phase commit and sufficient for single-node operation

### Write Order: DB First, File Second

This is a deliberate design choice. If we wrote the file first:
- A file could exist without a DB row, causing phantom cards in directory listings
- Relation graph queries would miss the card
- FTS search would not find it

By writing DB first, a failure leaves a DB row with no file. This is detectable and recoverable via `syncCardFromFile` / `bulkSyncCards`.

## Key Invariants

- **Lock granularity**: Per-key locks using a WeakMap keyed on `EmberdeckContext`. When the context is GC'd, all locks are freed. No global lock contention.
- **Transaction scope**: The entire DB write (card upsert + relations + classifications + code links) happens in a single synchronous Drizzle transaction. This prevents partial DB state.
- **Duplicate check**: `createCard` checks file existence on disk, not just DB. This catches orphan files from prior failed operations.
- **Acceptance required**: `createCard` throws `CardValidationError` if acceptance criteria are empty. This is an intentional product decision — cards must be testable.
- **Status immutability on create**: New cards always get `draft` status. The `updateCardStatus` function is the only way to transition status.

## Scope Boundaries

- This card covers write operations only. Read operations (get, list, search) are in `card-queries`.
- Sync operations (file-to-DB rebuild) are in `card-sync`.
- The `withRetry` utility is generic but currently only used for SQLITE_BUSY. It does not retry application-level errors.
