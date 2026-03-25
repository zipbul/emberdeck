---
{key: card-locking-contract,summary: "Per-key FIFO locking, alphabetical ordering, and retry parameters",status: active,type: spec,parent: concurrency-safety,codeLinks: [{kind: function,file: src/ops/safe.ts,symbol: withCardLock},{kind: function,file: src/ops/safe.ts,symbol: withRetry}],tags: [contract,concurrency],relations: [concurrency-safety]}
---
## Contracts
### withCardLock
- WHEN concurrent writes target same card key THEN second caller waits until first completes (FIFO queue)
- WHEN lock released THEN next queued caller proceeds immediately
- WHEN EmberdeckContext is garbage collected THEN all locks for that context are automatically cleaned (WeakMap)
- WHEN lock is last in queue and released THEN lock entry is deleted from map (no memory leak)

### withRetry
- WHEN SQLITE_BUSY error occurs THEN retry with exponential backoff: delay = min(50ms × 2^attempt, 2000ms)
- WHEN max retries (3) exceeded THEN throw last SQLITE_BUSY error
- WHEN non-BUSY error occurs THEN throw immediately (no retry)

### Rename lock ordering
- WHEN rename called THEN both old key and new key are locked
- WHEN locking multiple keys THEN alphabetical sort order prevents deadlock
- WHEN two renames cross (A→B and B→A) THEN both acquire locks in same order (A then B)

## Cross-module contracts
- All CRUD write operations (create, update, delete, rename) use withCardLock
- withRetry wraps the inner DB transaction, not the outer lock — retry happens inside the lock
- SQLite PRAGMA busy_timeout 5000ms is a separate, independent retry mechanism at the DB driver level