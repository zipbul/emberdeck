---
{key: dual-storage,summary: DB and file dual-storage invariant with compensation pattern for all card mutations,status: draft,type: intent,glossary: [dual-storage,compensation,card-lock]}
---

## Motivation
Emberdeck stores every card in two places: a database (for fast queries and relations) and a markdown file (for human-readable, git-trackable artifacts). If either store is updated without the other, the system enters an inconsistent state where queries return stale data or files show outdated content. A reliable synchronization protocol is required to prevent silent divergence.

## Scope
- Covers: mutation ordering (DB-first, then file), failure compensation, concurrency serialization, forward sync (file to DB), reverse sync (DB to file), bulk sync with duplicate detection.
- Excludes: database schema design, markdown serialization format, file system atomicity mechanisms.
- Assumes: the database supports transactions; file operations are non-transactional.

## Scenario

### P1: Successful card creation
Given a valid card input,
When createCard is called,
Then the card is inserted into DB and written to file atomically.

### P1: File write failure triggers compensation
Given a card was successfully inserted into DB,
When the subsequent file write fails,
Then the DB insertion is rolled back via compensation, and the caller receives the original file error.

### P1: Compensation itself fails
Given file write failed and compensation is attempted,
When the compensation (DB rollback) also fails,
Then a CompensationError is thrown containing both the original and compensation errors.

### P2: Concurrent mutations on the same card are serialized
Given two concurrent mutation calls target the same card key,
When both enter the mutation path,
Then they execute in FIFO order — the second waits for the first to complete.

### P2: File-to-DB sync restores consistency
Given a card file was externally modified,
When syncCardFromFile is called,
Then the DB is updated to match the file content, including relations, tags, and code links.

### P3: Bulk sync detects duplicate keys
Given two card files declare the same key,
When bulkSyncCards is called,
Then both files are reported as errors and neither is synced to prevent data loss.

## Rule
- R-001: Every mutation MUST follow DB-first then file ordering. File MUST NOT be written before DB commit.
- R-002: If file write fails after DB commit, compensation MUST attempt to revert DB to pre-mutation state.
- R-003: Concurrent mutations on the same card key MUST be serialized in FIFO order.
- R-004: Bulk sync MUST reject files with duplicate keys rather than silently overwriting.
- R-005: Reverse sync (DB to file) MUST reconstruct full frontmatter from DB state including relations, tags, and code links.

## Constraint
- Database transactions are synchronous; file operations are asynchronous. The system cannot wrap both in a single atomic transaction.
- Card files may be modified externally (by users or other tools), requiring file-to-DB sync as a recovery mechanism.

## Risk
- If compensation fails, DB and file are permanently inconsistent until manual intervention or file-to-DB sync.
- Concurrent access from outside the lock scope (e.g., direct file edits) can cause undetected divergence.
- Bulk sync with many files may encounter partial failures where some files sync and others do not.

## Criteria
- SC-001: 0 cases where DB commit succeeds and file write fails without compensation attempt.
- SC-002: 0 deadlocks from concurrent card mutations.
- SC-003: After any successful mutation, DB and file content MUST be byte-equivalent for all frontmatter fields.
- SC-004: Bulk sync with duplicate keys MUST report all duplicates and sync 0 of the conflicting files.

## Decision
- DB-first ordering was chosen over file-first because DB transactions can be rolled back atomically, while file renames cannot. This makes compensation simpler.
- Per-key locks (not global locks) were chosen to maximize concurrency — mutations on different cards proceed in parallel.
- Compensation restores DB state rather than retrying file write, because file failures are often persistent (disk full, permission denied) and retrying would waste time.
