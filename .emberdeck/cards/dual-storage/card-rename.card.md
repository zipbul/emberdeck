---
{key: dual-storage/card-rename,summary: "Card rename with dual-lock deadlock prevention, FK CASCADE propagation, and file restore on failure",status: draft,type: spec,parent: dual-storage,boundary: [src/ops/rename.ts],relations: [dual-storage,dual-storage/mutation-safety],codeLinks: [{kind: function,file: src/ops/rename.ts,symbol: renameCard}],glossary: [dual-storage,card-lock]}
---

## Contract
- GIVEN a valid source key and destination key
  WHEN renameCard is called
  THEN the file MUST be moved first, frontmatter key updated, then DB key updated via raw UPDATE triggering FK CASCADE.
- GIVEN source and destination keys
  WHEN both keys need locking
  THEN locks MUST be acquired in alphabetical order to prevent deadlocks.
- GIVEN the DB UPDATE fails after file move
  WHEN error recovery runs
  THEN the file MUST be moved back to the original path and frontmatter key restored.
- GIVEN a successful rename
  WHEN other cards reference the old key in parent or relations
  THEN those cards' files MUST be updated with the new key (best-effort).
- GIVEN a successful rename
  WHEN other cards mention the old key in their body text
  THEN those card keys MUST be returned in bodyReferencesFound for manual review.

## Invariant
- Lock ordering MUST be alphabetical regardless of which key is source vs destination.
- FK CASCADE on the card table MUST propagate the key change to all referencing tables (relations, tags, codeLinks, changelog).
- The rename operation is file-first (unlike CRUD which is DB-first) because file move is the harder-to-compensate step.
- Source key MUST exist on disk; destination key MUST NOT exist on disk.

## Failure
| Violation | System behavior |
|-----------|----------------|
| Source file does not exist | CardNotFoundError |
| Destination file already exists | CardAlreadyExistsError |
| Source equals destination path | CardRenameSamePathError |
| Invalid key format (source or destination) | CardKeyError thrown before any operation |
| DB UPDATE fails after file move | File moved back, frontmatter restored |
| Referencing card file update fails | Key added to failedReferenceUpdates array |
