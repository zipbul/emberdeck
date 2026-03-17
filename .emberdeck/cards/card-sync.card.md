---
{key: card-sync,summary: "Bidirectional file-DB sync — import, export, bulk scan, consistency validation",status: draft,type: feature,priority: high,acceptance: [{id: AC1,description: syncCardFromFile upserts DB from a .card.md file idempotently,verified: false},{id: AC2,description: bulkSyncCards scans directory and syncs all .card.md files,verified: false},{id: AC3,description: "validateCards detects stale DB rows, orphan files, and key mismatches without modifying data",verified: false},{id: AC4,description: exportCardToFile writes DB state to .card.md file,verified: false}],keywords: [sync,import,export,validate,consistency,bulk],tags: [ops,sync],relations: [{type: depends-on,target: persistence},{type: depends-on,target: card-io},{type: depends-on,target: card-model}],codeLinks: [{kind: function,file: src/ops/sync.ts,symbol: syncCardFromFile},{kind: function,file: src/ops/sync.ts,symbol: bulkSyncCards},{kind: function,file: src/ops/sync.ts,symbol: validateCards},{kind: function,file: src/ops/sync.ts,symbol: exportCardToFile}]}
---
## Why

Cards exist in two representations: markdown files (human-editable, git-trackable) and DB rows (queryable, indexed). These can diverge when files are edited outside emberdeck (e.g., manual git merge, text editor). Sync operations restore consistency.

`syncCardFromFile` is the recovery primitive — it reads a file and upserts the DB. This is also the compensation target for failed write operations: when a DB update succeeds but the file write fails, `syncCardFromFile` re-reads the original file to restore DB consistency.

`bulkSyncCards` scans a directory for all `.card.md` files and syncs each one. This is the bootstrap operation for projects that already have card files but no DB.

`validateCards` is a read-only audit: it compares DB rows against files on disk and reports three types of inconsistency: stale DB rows (file changed but DB not updated), orphan files (file exists but no DB row), and key mismatches (file's frontmatter key doesn't match expected path-derived key).

`exportCardToFile` is the reverse direction: DB → file. Used when DB is the source of truth (e.g., after programmatic updates) and the file needs to reflect DB state.

## Invariants

- `syncCardFromFile` is idempotent — calling it twice on the same file produces the same DB state.
- `bulkSyncCards` processes files in no guaranteed order. Each file is an independent operation.
- `validateCards` never modifies data — pure read comparison.
- `exportCardToFile` overwrites the file unconditionally — no merge, no conflict check.

## Scope Boundaries

- Does NOT handle concurrent file edits during sync — no file locking.
- Does NOT debounce rapid file changes — caller should debounce if using a file watcher.
- Does NOT support non-markdown card formats (no JSON/YAML export).
- Does NOT auto-resolve conflicts between file and DB — caller decides which direction to sync.
- Does NOT clean up orphaned keyword/tag rows after sync.

## Edge Cases

- File with valid YAML but missing required frontmatter fields: `syncCardFromFile` throws `CardValidationError`.
- Card key in file doesn't match path-derived key: `validateCards` reports as mismatch.
- DB row exists but file was deleted: `validateCards` reports as "DB orphan".
- File exists but not in DB: `validateCards` reports as "file orphan"; `bulkSyncCards` creates the DB row.