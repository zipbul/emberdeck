---
{key: sync-file-authority,summary: File-to-DB sync direction and body authority contract,status: active,type: spec,parent: data-integrity,boundary: [src/ops/sync.ts],codeLinks: [{kind: function,file: src/ops/sync.ts,symbol: syncCardFromFile},{kind: function,file: src/ops/sync.ts,symbol: bulkSyncCards},{kind: function,file: src/ops/sync.ts,symbol: validateCards},{kind: function,file: src/ops/sync.ts,symbol: exportCardToFile}],tags: [contract,sync],relations: [data-integrity]}
---
## Contracts
- WHEN syncCardFromFile called THEN file content overwrites DB state (file is source of truth for body + frontmatter)
- WHEN bulkSyncCards called THEN all .card.md files in cardsDir are scanned and synced to DB
- WHEN duplicate keys detected in bulkSync THEN ALL files with duplicate keys are reported as errors, none synced (prevents data loss)
- WHEN bulkSync processes files THEN batches of 20 (parallel file reads, sequential DB writes)
- WHEN exportCardToFile called THEN DB state overwrites file (reverse direction — DB to file)
- WHEN validateCards called THEN reports: staleDbRows (DB without file), orphanFiles (file without DB), keyMismatches
- WHEN validateCards structural checks run THEN warns: orphan-card, broken-parent, type-hierarchy-violation, broken-relation, rework-dependency (active→draft dep), empty-tree, boundary-overlap, broken-chain (spec not connected to intent)

## Cross-module contracts
- syncCardFromFile is used as compensation in update and delete ops (re-sync from file to undo DB change)
- Body content is NEVER stored in DB — only filePath is recorded; queries that need body must read the file
- Frontmatter fields in file are mapped to DB columns; any frontmatter field change in file propagates to DB on sync