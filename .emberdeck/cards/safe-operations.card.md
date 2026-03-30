---
{key: safe-operations,summary: "Design document for DB-first-then-file pattern, compensation on failure, card locking, retry on SQLITE_BUSY, and transaction safety",status: draft,type: intent,boundary: [src/ops/safe.ts,src/db/connection.ts],tags: [safety,transactions,concurrency],glossary: [compensation,dual-storage,card]}
---
## Problem & Goals

**Problem**: Emberdeck maintains two storage layers (SQLite DB and markdown files) that must stay in sync. Any mutation that succeeds in one layer but fails in the other creates an inconsistent state that corrupts the design knowledge base. Additionally, concurrent access from multiple agent threads and SQLite's locking behavior introduce race conditions and deadlocks.

**Who has it**: Every Emberdeck operation that writes data. The dual-storage architecture means every create, update, delete, and sync operation is a distributed write across two systems with different failure modes.

**What breaks without this**: DB and file diverge silently. A card exists in DB but not on disk (or vice versa). Concurrent updates to the same card cause lost writes. SQLITE_BUSY errors crash the agent instead of being retried.

**Success looks like**: All mutations follow the DB-first-then-file pattern. File write failures trigger automatic DB compensation. Concurrent operations on the same card are serialized via FIFO locking. Transient SQLITE_BUSY errors are retried with exponential backoff. CompensationError is thrown only when both the original operation AND the rollback fail.

## User Scenarios

### P1: Safe write with compensation
- **Given** a card create/update/delete operation
- **When** the DB transaction succeeds but the file write fails
- **Then** the compensation function is called to revert DB changes
- **And** the original file write error is re-thrown to the caller
- **And** if compensation also fails, a CompensationError wrapping both errors is thrown

### P1: Card-level FIFO locking
- **Given** two concurrent operations targeting the same card key
- **When** both operations are invoked simultaneously
- **Then** the second operation waits for the first to complete (FIFO order)
- **And** locks are per-context and per-key, using a WeakMap for automatic cleanup
- **And** after the operation completes, the lock is released even if the operation threw

### P1: SQLITE_BUSY retry with backoff
- **Given** a database operation encounters SQLITE_BUSY (database is locked)
- **When** withRetry wraps the operation
- **Then** up to 3 retries are attempted with exponential backoff (50ms, 100ms, 200ms)
- **And** non-SQLITE_BUSY errors are immediately re-thrown (no retry)
- **And** the maximum delay is capped at 2000ms

### P2: Atomic file writes via temp file
- **Given** a card file needs to be written
- **When** writeCardFile is called
- **Then** content is written to a .tmp file with random suffix first
- **And** the temp file is atomically renamed to the final path
- **And** if rename fails, the temp file is cleaned up

### P3: Transaction isolation
- **Given** a card operation involves multiple DB tables (card, relations, tags, codeLinks, changelog)
- **When** the operation runs inside ctx.db.transaction()
- **Then** all table writes are atomic: either all succeed or all are rolled back
- **And** the transaction uses txDb() to create a scoped Drizzle instance

## Requirements

- **FR-001**: safeWriteOperation MUST execute dbAction first, then fileAction; never the reverse.
- **FR-002**: safeWriteOperation MUST call compensate when fileAction throws after dbAction succeeds.
- **FR-003**: safeWriteOperation MUST throw CompensationError when both fileAction and compensate throw, wrapping both original and compensation errors.
- **FR-004**: withCardLock MUST serialize concurrent operations for the same context+key pair in FIFO order.
- **FR-005**: withCardLock MUST use WeakMap keyed by EmberdeckContext so locks are garbage-collected when context is released.
- **FR-006**: withCardLock MUST release the lock in a finally block, ensuring release even on exceptions.
- **FR-007**: withRetry MUST retry only on SQLITE_BUSY errors (message contains "database is locked").
- **FR-008**: withRetry MUST use exponential backoff: delay = min(baseDelayMs * 2^attempt, maxDelayMs).
- **FR-009**: withRetry defaults MUST be: maxRetries=3, baseDelayMs=50, maxDelayMs=2000.
- **FR-010**: writeCardFile MUST use write-to-temp-then-rename pattern for atomic file updates.
- **FR-011**: writeCardFile MUST clean up the temp file if rename fails.
- **FR-012**: All multi-table DB operations MUST run inside a single ctx.db.transaction() call.

## Success Criteria

- Zero orphaned states: every DB row has a matching file and vice versa after any operation completes (success or failure).
- SQLITE_BUSY errors never surface to the caller unless 3 retries are exhausted.
- Concurrent operations on the same card never corrupt data (serialized via lock).
- CompensationError is the only path where dual-storage can remain inconsistent, and it surfaces both errors for manual inspection.

## Scope & Constraints

**Covers**: safeWriteOperation pattern, withCardLock, withRetry, writeCardFile atomic writes, deleteCardFile, DB transaction boundaries, CompensationError.

**Excludes**: The specific business logic of create/update/delete (see card-lifecycle intent). Glossary locking (see glossary-system intent).

**Assumes**: Bun.sleep is available for retry delays. Bun.write is available for file operations. node:fs/promises rename is used for atomic moves. WeakMap is suitable for lock lifecycle management.