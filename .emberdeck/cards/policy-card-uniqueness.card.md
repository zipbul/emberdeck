---
{key: policy-card-uniqueness,summary: "Card keys are globally unique; duplicate key creation is rejected, and rename checks destination availability before proceeding",status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: createCard throws CardAlreadyExistsError when a file with the same slug already exists on disk,verified: false},{id: ac-2,description: renameCard throws CardAlreadyExistsError when the destination slug already exists on disk,verified: false},{id: ac-3,description: renameCard throws CardRenameSamePathError when source and destination resolve to the same path,verified: false}],keywords: [CardAlreadyExistsError,primary-key,uniqueness,duplicate],tags: [policy,uniqueness,identity],relations: [{type: related,target: policy-card-key-safety}],codeLinks: [{kind: class,file: src/card/errors.ts,symbol: CardAlreadyExistsError},{kind: class,file: src/card/errors.ts,symbol: CardRenameSamePathError},{kind: function,file: src/ops/create.ts,symbol: createCard},{kind: function,file: src/ops/rename.ts,symbol: renameCard}]}
---
## Policy

The card key (normalized slug) is a primary key in the DB and maps 1:1 to a filesystem path via `buildCardPath`. No two cards may share the same key. This is enforced at the operations layer, not just the DB.

## Enforcement points

1. **createCard**: checks `Bun.file(filePath).exists()` before writing. Throws `CardAlreadyExistsError` if the file already exists.
2. **renameCard**: checks that the destination file does not exist. Throws `CardAlreadyExistsError` if it does.
3. **DB**: `card.key` is the primary key, so a duplicate INSERT would fail at the SQL level as a last-resort guard.

## Why file-level check

The DB uses `upsert` (INSERT OR REPLACE), so it cannot detect duplicates on its own. The file existence check is the primary guard. This also catches edge cases where a file exists on disk but is not yet synced to the DB.

## What breaks if violated

- Two cards with the same key would overwrite each other's file content.
- Relations, code links, and changelog entries would merge across unrelated cards.
- `getCard` would return ambiguous results.

## Exclusions

- `bulkCreateCards` delegates to `createCard` per item, so the same uniqueness check applies. Failed items are skipped; remaining items continue.
- No-op renames (same source and destination) are caught separately by `CardRenameSamePathError`.