---
{key: dual-storage/mutation-safety,summary: "DB-first ordering, compensation on file failure, per-key lock serialization, and BUSY retry",status: draft,type: spec,parent: dual-storage,boundary: [src/ops/safe.ts],codeLinks: [{kind: function,file: src/ops/safe.ts,symbol: safeWriteOperation},{kind: function,file: src/ops/safe.ts,symbol: withCardLock},{kind: function,file: src/ops/safe.ts,symbol: withRetry},{kind: class,file: src/card/errors.ts,symbol: CompensationError}],glossary: [dual-storage,compensation,card-lock],relations: [dual-storage]}
---

## Contract
- GIVEN a mutation calls safeWriteOperation with dbAction, fileAction, and compensate
  WHEN dbAction succeeds and fileAction succeeds
  THEN the mutation result from dbAction MUST be returned.
- GIVEN dbAction succeeds
  WHEN fileAction throws an error
  THEN compensate MUST be called, and the original file error MUST be re-thrown to the caller.
- GIVEN dbAction succeeds and fileAction fails
  WHEN compensate also fails
  THEN a CompensationError MUST be thrown containing both the original error and the compensation error.
- GIVEN two concurrent calls target the same card key via withCardLock
  WHEN the first call is in progress
  THEN the second call MUST wait until the first completes before starting.
- GIVEN a function wrapped in withRetry encounters a database-locked error
  WHEN the retry limit has not been reached
  THEN the function MUST be retried with exponential backoff.

## Invariant
- dbAction MUST always execute before fileAction. fileAction MUST NEVER run if dbAction was not called.
- Per-key locks are FIFO — the order in which calls arrive is the order in which they execute.
- withRetry MUST only retry on database-locked errors. All other errors MUST be thrown immediately.
- Lock state MUST be automatically cleaned up when the context is garbage collected (no memory leaks).

## Failure
| Violation | System behavior |
|-----------|----------------|
| fileAction throws after dbAction succeeds | compensate is called; original error is re-thrown |
| compensate throws after fileAction failure | CompensationError thrown with both errors |
| Database locked during dbAction | withRetry retries with exponential backoff up to max retries |
| Max retries exceeded on database lock | Last database-locked error is thrown |
| Non-database-lock error during dbAction | Error thrown immediately, no retry |
