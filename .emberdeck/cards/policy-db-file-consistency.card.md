---
{key: policy-db-file-consistency,summary: Every card mutation must keep the SQLite DB and .card.md file in lockstep; if either side diverges the system is corrupted,status: draft,type: decision,priority: critical,acceptance: [{id: ac-1,description: "All write ops (create, update, delete, rename, verifyAcceptance, updateCardStatus) route through safeWriteOperation or an equivalent compensating pattern",verified: false},{id: ac-2,description: File write failure after DB success triggers compensate callback that restores DB to pre-operation state,verified: false},{id: ac-3,description: CompensationError is thrown (never swallowed) when both file write and compensation fail,verified: false}],keywords: [safeWriteOperation,CompensationError,dual-write,atomicity],tags: [policy,consistency,critical-invariant],codeLinks: [{kind: function,file: src/ops/safe.ts,symbol: safeWriteOperation},{kind: class,file: src/card/errors.ts,symbol: CompensationError},{kind: function,file: src/ops/create.ts,symbol: createCard},{kind: function,file: src/ops/update.ts,symbol: updateCard},{kind: function,file: src/ops/delete.ts,symbol: deleteCard}]}
---
## Policy

Every write operation (create, update, delete, rename) must atomically update both the SQLite database and the `.card.md` filesystem artifact. If the filesystem write fails after the DB succeeds, the DB must be rolled back (compensated). If compensation itself fails, a `CompensationError` is thrown to surface the inconsistency for manual repair.

## Rationale

The DB is the query engine (FTS, relations, classification); the file is the portable, git-diffable artifact. Neither alone is sufficient. The DB without a file means the card cannot be exported or version-controlled. A file without a DB row means the card is invisible to search, relation graphs, and impact analysis.

## Mechanism

`safeWriteOperation` enforces DB-first, file-second ordering:
1. Execute `dbAction` synchronously inside a transaction.
2. Execute `fileAction` asynchronously.
3. On file failure, execute `compensate` to restore DB state.
4. If compensate fails, throw `CompensationError` with both errors.

## What breaks if violated

- `searchCards` returns phantom cards that have no file.
- `getCard` reads stale file content that disagrees with DB state.
- `bulkSyncCards` or `validateCards` reports mismatches requiring manual intervention.
- Changelog entries reference states that never reached disk.

## Exclusions

- Read-only operations (`getCard`, `listCards`, `searchCards`) do not use `safeWriteOperation`.
- `syncCardFromFile` and `bulkSyncCards` are repair paths that intentionally overwrite DB state from files; they bypass the pattern because they ARE the compensation.