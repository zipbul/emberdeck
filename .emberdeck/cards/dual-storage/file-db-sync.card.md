---
{key: dual-storage/file-db-sync,summary: "File-to-DB sync, DB-to-file export, and bulk sync with duplicate key detection",status: draft,type: spec,parent: dual-storage,boundary: [src/ops/sync.ts],codeLinks: [{kind: function,file: src/ops/sync.ts,symbol: syncCardFromFile},{kind: function,file: src/ops/sync.ts,symbol: bulkSyncCards},{kind: function,file: src/ops/sync.ts,symbol: exportCardToFile},{kind: function,file: src/ops/sync.ts,symbol: validateCards}],glossary: [dual-storage],relations: [dual-storage]}
---

## Contract
- GIVEN a card file exists on disk
  WHEN syncCardFromFile is called with the file path
  THEN the DB MUST be upserted with the file's frontmatter, body, relations, tags, and code links in a single transaction.
- GIVEN a card exists in DB with all related data
  WHEN exportCardToFile is called
  THEN a card file MUST be written with reconstructed frontmatter including relations, tags, code links, and glossary.
- GIVEN multiple card files exist in a directory
  WHEN bulkSyncCards is called
  THEN files with unique keys MUST be synced to DB, and files with duplicate keys MUST be rejected as errors.
- GIVEN bulkSyncCards encounters duplicate keys
  WHEN two or more files declare the same key
  THEN all duplicating files MUST be reported as errors and NONE of them synced.
- GIVEN validateCards is called
  WHEN DB rows reference files that no longer exist
  THEN those rows MUST be reported as stale.

## Invariant
- syncCardFromFile MUST upsert (not just insert) — re-syncing the same file twice produces identical DB state.
- bulkSyncCards MUST NOT modify DB state for any file involved in a duplicate key conflict.
- After a successful exportCardToFile, the file content MUST match the DB state for all frontmatter fields.

## Failure
| Violation | System behavior |
|-----------|----------------|
| Card file has invalid frontmatter | syncCardFromFile throws CardValidationError |
| File not found during syncCardFromFile | Filesystem error propagated to caller |
| Duplicate keys in bulkSyncCards | All conflicting files reported as errors, none synced |
| DB row references nonexistent file | Reported as staleDbRow in validateCards result |
| File exists but no DB row | Reported as orphanFile in validateCards result |
| DB status differs from file status | Reported as content-mismatch warning in validateCards |
