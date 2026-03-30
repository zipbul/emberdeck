---
{key: spec/safe-write-primitives,summary: "Behavioral contract for safeWriteOperation, withCardLock, withRetry, and atomic file write patterns",status: draft,type: spec,parent: safe-operations,boundary: [src/ops/safe.ts,src/fs/writer.ts],tags: [safety,lock,retry,atomic],relations: [card-lifecycle],codeLinks: [{kind: function,file: src/ops/safe.ts,symbol: safeWriteOperation},{kind: function,file: src/ops/safe.ts,symbol: withCardLock},{kind: function,file: src/ops/safe.ts,symbol: withRetry},{kind: interface,file: src/ops/safe.ts,symbol: SafeWriteOptions},{kind: interface,file: src/ops/safe.ts,symbol: RetryOptions},{kind: function,file: src/fs/writer.ts,symbol: writeCardFile},{kind: function,file: src/fs/writer.ts,symbol: deleteCardFile}],glossary: [compensation,dual-storage,card]}
---
## Contracts

### C-01: DB-first-then-file execution order
- **Given** a SafeWriteOptions with dbAction, fileAction, and compensate
- **When** safeWriteOperation is called
- **Then** dbAction MUST execute first and its return value is captured
- **And** fileAction MUST execute second (only after dbAction succeeds)
- **And** if dbAction throws, fileAction and compensate are never called

### C-02: Compensation on file failure
- **Given** dbAction succeeds but fileAction throws
- **When** safeWriteOperation handles the error
- **Then** compensate MUST be called with the dbAction result
- **And** if compensate succeeds, the original fileAction error is re-thrown
- **And** if compensate also throws, CompensationError MUST be thrown wrapping both errors

### C-03: FIFO card-level locking
- **Given** two concurrent calls to withCardLock for the same context and key
- **When** both are invoked
- **Then** the second call MUST await the first call's completion before executing
- **And** the lock MUST be released in a finally block (even on exception)
- **And** when the current lock is the latest for that key, it is deleted from the map

### C-04: Lock isolation by context
- **Given** two different EmberdeckContext instances
- **When** withCardLock is called on both for the same key
- **Then** the operations run independently (no cross-context blocking)
- **And** WeakMap ensures locks are garbage-collected when the context is released

### C-05: SQLITE_BUSY retry logic
- **Given** an operation that throws with message containing "database is locked"
- **When** withRetry wraps the operation
- **Then** up to maxRetries (default 3) additional attempts are made
- **And** delay between attempts follows exponential backoff: min(baseDelayMs * 2^attempt, maxDelayMs)
- **And** default values: baseDelayMs=50, maxDelayMs=2000
- **And** non-SQLITE_BUSY errors are immediately re-thrown without retry

### C-06: Atomic file write via temp-rename
- **Given** a card file to write
- **When** writeCardFile is called
- **Then** content is serialized via serializeCardMarkdown
- **And** written to a temp file (filePath + '.tmp.' + random hex)
- **And** temp file is atomically renamed to the final path
- **And** if rename fails, the temp file is deleted (cleanup) and the error is re-thrown

### C-07: File deletion
- **Given** a card file path
- **When** deleteCardFile is called
- **Then** the file is deleted if it exists
- **And** if the file does not exist, no error is thrown

## Failure Modes

| Violation | System Behavior |
|---|---|
| dbAction throws | Error propagated directly, no fileAction or compensate |
| fileAction throws, compensate succeeds | Original error re-thrown |
| fileAction throws, compensate throws | CompensationError with both errors |
| SQLITE_BUSY, retries exhausted | Last SQLITE_BUSY error re-thrown |
| Non-SQLITE_BUSY error | Immediately re-thrown (no retry) |
| Temp file rename fails | Temp file cleaned up, rename error re-thrown |
| deleteCardFile on missing file | No-op (no error) |