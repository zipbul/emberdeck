---
{key: policy-concurrency-serialization,summary: Concurrent mutations to the same card are serialized via per-key FIFO locks; SQLite BUSY errors trigger exponential backoff retry,status: draft,type: decision,priority: critical,acceptance: [{id: ac-1,description: "All write operations (create, update, delete, rename, verifyAcceptance, updateCardStatus) wrap their logic in withCardLock",verified: false},{id: ac-2,description: withRetry only retries on SQLITE_BUSY; all other errors propagate immediately,verified: false},{id: ac-3,description: renameCard locks both keys in sorted alphabetical order,verified: false}],keywords: [withCardLock,withRetry,SQLITE_BUSY,deadlock,FIFO],tags: [policy,concurrency,critical-invariant],codeLinks: [{kind: function,file: src/ops/safe.ts,symbol: withCardLock},{kind: function,file: src/ops/safe.ts,symbol: withRetry},{kind: function,file: src/ops/rename.ts,symbol: renameCard}]}
---
## Policy

All write operations on a card must be wrapped in `withCardLock(ctx, key, fn)`. This serializes concurrent calls for the same card key in FIFO order. Cross-card contention on the SQLite level is handled by `withRetry`, which retries on `SQLITE_BUSY` with exponential backoff (base 50ms, max 2000ms, 3 retries).

## Mechanism

- `withCardLock` uses a `WeakMap<EmberdeckContext, Map<string, Promise<void>>>`. Each key gets a promise chain; new calls await the previous promise before executing. Locks are cleaned up when the context is garbage collected.
- `withRetry` catches errors containing "database is locked" and retries. Non-busy errors propagate immediately.

## Rename deadlock prevention

`renameCard` must lock both the old key and the new key. Keys are locked in alphabetical order to prevent ABBA deadlocks when two concurrent renames cross paths.

## What breaks if violated

- Two concurrent `updateCard` calls on the same key could read stale file state and overwrite each other's changes (lost update).
- Without retry, a single concurrent write could fail with SQLITE_BUSY even though the contention is transient.
- Rename without ordered locking could deadlock when A->B and B->A happen simultaneously.

## Exclusions

- Read operations (`getCard`, `listCards`, `searchCards`) do not acquire locks. SQLite's WAL mode provides read isolation.
- `bulkSyncCards` processes files in parallel batches of 20 but each individual sync acquires its own transaction.