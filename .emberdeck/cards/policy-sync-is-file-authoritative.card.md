---
{key: policy-sync-is-file-authoritative,summary: "syncCardFromFile and bulkSyncCards treat the filesystem as the source of truth, overwriting DB state unconditionally",status: draft,type: decision,priority: medium,acceptance: [{id: ac-1,description: syncCardFromFile overwrites DB state from file content without applying relation type or size limit validation,verified: false},{id: ac-2,description: "bulkSyncCards processes all .card.md files in the cards directory, including nested subdirectories",verified: false},{id: ac-3,description: "exportCardToFile reconstructs a valid .card.md file from DB state (relations, keywords, tags, codeLinks)",verified: false}],keywords: [syncCardFromFile,bulkSyncCards,exportCardToFile,removeCardByFile,file-authoritative],tags: [policy,sync,file-authority],relations: [{type: related,target: policy-db-file-consistency}],codeLinks: [{kind: function,file: src/ops/sync.ts,symbol: syncCardFromFile},{kind: function,file: src/ops/sync.ts,symbol: bulkSyncCards},{kind: function,file: src/ops/sync.ts,symbol: exportCardToFile},{kind: function,file: src/ops/sync.ts,symbol: validateCards},{kind: function,file: src/ops/sync.ts,symbol: removeCardByFile}]}
---
## Policy

The sync path (`syncCardFromFile`, `bulkSyncCards`) reads a `.card.md` file and upserts its full content into the DB. This is a file-authoritative operation: the file wins, the DB is overwritten. No validation of relation types, acceptance criteria, or size limits is performed during sync.

## Use cases

1. **Compensation**: when a file write fails after a DB mutation, the compensate callback calls `syncCardFromFile` to restore DB state from the (unchanged) file.
2. **External edits**: when a user manually edits a `.card.md` file, a watcher calls `syncCardFromFile` to keep the DB in sync.
3. **Bootstrap**: `bulkSyncCards` scans the entire cards directory and syncs all files to the DB on startup.
4. **Reverse direction**: `exportCardToFile` does the opposite — DB to file — for DB-authoritative recovery.

## What breaks if violated

- If sync applied validation, manually edited files with non-standard relation types would be rejected, making external editing impossible.
- If sync was DB-authoritative, compensation would overwrite the (correct) file with the (stale) DB state.

## Exclusions

- `removeCardByFile` handles the delete case: when a file is deleted externally, it removes the DB row and prunes orphans.
- `validateCards` is read-only — it detects inconsistencies but does not fix them.