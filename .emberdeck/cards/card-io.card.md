---
{key: card-io,summary: "Card file I/O — read, write, delete card files on disk with package root discovery",status: draft,type: feature,priority: high,acceptance: [{id: AC1,description: readCardFile returns parsed CardFile with filePath for valid .card.md files,verified: false},{id: AC2,description: writeCardFile serializes CardFile to disk via Bun.write,verified: false},{id: AC3,description: deleteCardFile is idempotent — no throw if file already absent,verified: false},{id: AC4,description: findPackageRoot returns project root or original path if no package.json found,verified: false}],keywords: [filesystem,read,write,delete,package-root],tags: [core,io],relations: [{type: depends-on,target: card-model}],codeLinks: [{kind: function,file: src/fs/reader.ts,symbol: readCardFile},{kind: function,file: src/fs/writer.ts,symbol: writeCardFile},{kind: function,file: src/fs/writer.ts,symbol: deleteCardFile},{kind: function,file: src/fs/package-root.ts,symbol: findPackageRoot}]}
---
## Why

File I/O is separated from domain model and persistence because cards exist as both markdown files (human-readable, git-trackable) and DB rows (queryable, indexed). The filesystem layer is the bridge — it serializes/deserializes without knowing about DB or validation logic.

`writeCardFile` deliberately does NOT create parent directories. Directory creation is the caller's responsibility because the ops layer needs to control when directories are created (e.g., during card creation, not during arbitrary writes). Pushing this down would hide side effects.

`deleteCardFile` is idempotent — does not throw if the file is already absent. This supports compensation patterns: if a DB rollback needs to "undo" a file delete, silently skipping a missing file is correct behavior.

`findPackageRoot` traverses upward to locate `package.json` because gildash requires an absolute project root for symbol indexing, and config file paths resolve relative to the project root by convention. If no `package.json` exists (e.g., bare directory), it returns the original path rather than throwing — graceful degradation over hard failure.

## Invariants

- `readCardFile` always returns a `CardFile` with `filePath` attached, or throws `CardValidationError`.
- `writeCardFile` uses `Bun.write` — atomicity depends on the Bun runtime's guarantees.
- `deleteCardFile` checks existence before delete; never throws on missing file.
- `findPackageRoot` is deterministic: same input always returns same output. Stops at first `package.json` found, not deepest.

## Scope Boundaries

- Does NOT create parent directories (caller's responsibility).
- Does NOT validate file permissions or disk space.
- Does NOT manage file locks or concurrent access (that's `safe.ts`).
- Does NOT implement atomic multi-file transactions.
- Does NOT parse or validate card content beyond structural YAML — content validation is `validation.ts`.
- Does NOT interact with the database.

## Edge Cases

- `findPackageRoot` at filesystem root (no `package.json` anywhere) returns the original input path.
- `readCardFile` on a file with valid YAML but missing required fields throws `CardValidationError`.
- `writeCardFile` overwrites existing file without warning.
- Windows paths with backslashes are handled by `path.resolve()` in `findPackageRoot`.