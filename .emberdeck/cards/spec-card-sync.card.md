---
{key: spec-card-sync,summary: "File-DB sync operations maintain consistency via sync, bulk sync, validation, and export",status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/sync.ts],codeLinks: [{kind: function,file: src/ops/sync.ts,symbol: syncCardFromFile},{kind: function,file: src/ops/sync.ts,symbol: bulkSyncCards},{kind: function,file: src/ops/sync.ts,symbol: validateCards},{kind: function,file: src/ops/sync.ts,symbol: exportCardToFile},{kind: function,file: src/ops/sync.ts,symbol: removeCardByFile}],glossary: [card,dual storage,drift],relations: [card-lifecycle]}
---

## Contracts
- WHEN syncCardFromFile is called, THEN the file is read and all DB tables (card, relations, tags, codeLinks) MUST be updated in a single transaction.
- WHEN bulkSyncCards encounters duplicate keys across files, THEN duplicates MUST be reported as errors and MUST NOT be synced (data loss prevention).
- WHEN validateCards is called, THEN it MUST detect: stale DB rows, orphan files, key mismatches, broken parents, type hierarchy violations, broken relations, boundary overlaps, content mismatches, glossary-broken, glossary-unused, and broken-chain (spec with no intent link).
- WHEN exportCardToFile is called, THEN DB state MUST be serialized to the card file (reverse sync).
- WHEN removeCardByFile is called, THEN the DB row and orphan tags MUST be cleaned up.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Duplicate key across files during bulk sync | Both files reported as errors, neither synced |
| File unreadable during validation | Caught by staleDbRows or orphanFiles detection |
| Card not found in DB for export | CardNotFoundError |
