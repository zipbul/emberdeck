---
{key: concurrency-safety,summary: "Per-key serialization rationale, lock ordering, retry philosophy",status: active,type: intent,parent: emberdeck,tags: [core,design],relations: [emberdeck]}
---
## Why
Multiple MCP tool calls can arrive concurrently for the same card. Without serialization, concurrent writes to the same card can corrupt both DB state and file content. SQLite WAL mode handles DB-level concurrency, but file I/O needs application-level coordination.

## Serialization model
- Per-card-key FIFO locks: only one write operation per card at a time
- Lock scope: per EmberdeckContext instance (WeakMap, auto-cleaned on GC)
- Read operations (getCard, listCards, searchCards) are lock-free — no read-write contention

## Lock ordering decision
- Rename operation must lock both old and new keys simultaneously
- Alphabetical sorting prevents deadlock when two renames cross (A→B and B→A simultaneously)
- Sorted order is deterministic regardless of call order

## Retry philosophy
- SQLITE_BUSY errors retried with exponential backoff (3 attempts, 50ms base, 2s cap)
- Application-level lock contention is NOT retried — callers wait in FIFO queue
- SQLite PRAGMA busy_timeout 5000ms provides additional DB-level retry as a safety net
- Non-BUSY errors are re-thrown immediately (no retry on logic errors)