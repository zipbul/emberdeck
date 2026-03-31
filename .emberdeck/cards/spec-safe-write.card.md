---
{key: spec-safe-write,summary: "DB-first-then-file write pattern with compensation, per-key FIFO lock, and SQLite BUSY retry",status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/safe.ts],codeLinks: [{kind: function,file: src/ops/safe.ts,symbol: safeWriteOperation},{kind: function,file: src/ops/safe.ts,symbol: withCardLock},{kind: function,file: src/ops/safe.ts,symbol: withRetry}],glossary: [dual storage,compensation],relations: [card-lifecycle]}
---

## Contracts
- WHEN safeWriteOperation is called, THEN dbAction MUST execute first, followed by fileAction. IF fileAction throws, compensate MUST be called to revert the DB change.
- WHEN compensate also fails after fileAction failure, THEN CompensationError MUST be thrown containing both the original error and the compensation error.
- WHEN withCardLock is called for a key, THEN concurrent calls for the same ctx+key MUST be serialized in FIFO order. Calls for different keys MUST proceed concurrently.
- WHEN withRetry encounters a SQLite BUSY error, THEN it MUST retry with exponential backoff up to maxRetries. Non-BUSY errors MUST be re-thrown immediately.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| File write fails after DB commit | compensate is called; if it succeeds, original error is re-thrown |
| Both file write and compensation fail | CompensationError thrown with both errors |
| SQLite BUSY during DB action | withRetry retries up to maxRetries with exponential backoff |
| Lock held by previous operation | Caller waits until previous operation for same key completes |
