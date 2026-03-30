---
{key: spec/sync-cards,summary: "Behavioral contract for syncCardFromFile, bulkSyncCards, validateCards, and exportCardToFile operations",status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/sync.ts],tags: [sync,validation,bulk],relations: [safe-operations,structural-integrity,glossary-system],codeLinks: [{kind: function,file: src/ops/sync.ts,symbol: syncCardFromFile},{kind: function,file: src/ops/sync.ts,symbol: bulkSyncCards},{kind: function,file: src/ops/sync.ts,symbol: validateCards},{kind: function,file: src/ops/sync.ts,symbol: exportCardToFile},{kind: function,file: src/ops/sync.ts,symbol: removeCardByFile},{kind: interface,file: src/ops/sync.ts,symbol: BulkSyncResult},{kind: interface,file: src/ops/sync.ts,symbol: CardValidationResult}],glossary: [card,dual-storage,relation,boundary,glossary]}
---
## Contracts

### C-01: syncCardFromFile full DB replacement
- **Given** a .card.md file that was externally modified
- **When** syncCardFromFile is called with its path
- **Then** the file is read and parsed into frontmatter + body
- **And** a DB transaction MUST atomically upsert the card row, replace relations, replace tags, and replace codeLinks
- **And** updatedAt is set to the current timestamp

### C-02: bulkSyncCards parallel read with duplicate detection
- **Given** a directory with .card.md files
- **When** bulkSyncCards is called
- **Then** all **/*.card.md files are scanned
- **And** duplicate keys across files are detected and reported as errors
- **And** duplicate files are excluded from sync (data loss prevention)
- **And** non-duplicate files are synced in parallel batches of BATCH_SIZE=20

### C-03: validateCards structural checks
- **Given** the card database and file system
- **When** validateCards is called
- **Then** stale DB rows (no matching file on disk) MUST be detected
- **And** orphan files (not in DB) MUST be detected
- **And** key mismatches (DB key vs computed key from file path) MUST be detected
- **And** warnings MUST include: orphan-card, broken-parent, type-hierarchy-violation, broken-relation, rework-dependency, empty-tree, boundary-overlap, content-mismatch, glossary-broken, glossary-undeclared-usage, glossary-phantom-declaration, glossary-unused, broken-chain

### C-04: validateCards boundary overlap detection
- **Given** two non-parent-child cards with boundary patterns
- **When** their patterns are checked for overlap
- **Then** identical patterns are flagged immediately
- **And** non-identical patterns are tested via generateSamplePaths + cross-glob matching
- **And** parent-child pairs are excluded from overlap checks

### C-05: exportCardToFile reverse sync
- **Given** a card key with complete DB state
- **When** exportCardToFile is called
- **Then** the card row, forward relations, tags, codeLinks, and glossary are assembled into a CardFile
- **And** the file is written via writeCardFile
- **And** reverse relations (isReverse=true) are excluded from the frontmatter

### C-06: removeCardByFile cleanup
- **Given** a card file was externally deleted
- **When** removeCardByFile is called
- **Then** the DB row is found by filePath and deleted
- **And** orphan tags are pruned

## Failure Modes

| Violation | System Behavior |
|---|---|
| File cannot be read/parsed | Error collected in bulkSyncResult.errors |
| Duplicate key across files | All files with that key are excluded from sync, reported as errors |
| Card not found for export | CardNotFoundError thrown |
| DB row not found for file removal | No-op (silently succeeds) |
| Content mismatch (DB vs file) | Warning in validation result, no auto-fix |