---
{key: data-integrity,summary: "DB-file split rationale, compensation philosophy, changelog policy",status: active,type: intent,parent: emberdeck,tags: [core,design],relations: [emberdeck]}
---
## Why
Cards exist in two systems simultaneously: SQLite DB (for queries, relationships, FTS) and markdown files (for body content, version control). Atomic transactions across both systems are impossible. The compensation pattern ensures consistency when one system fails after the other succeeds.

## DB-file split rationale
- DB is source of truth for: relationships (parent, relations, tags, codeLinks), status, structural metadata
- File is source of truth for: body content (narrative design knowledge)
- Neither system alone has complete state — sync operations bridge the gap
- Why not DB-only: markdown files are human-readable, version-controllable, diffable
- Why not file-only: relational queries (graph traversal, FTS, filtering) need structured storage

## Compensation philosophy
- DB action executes first (within a transaction), file action second (outside transaction)
- If file fails after DB succeeds: compensate by undoing DB change (create→delete, update→re-sync from file, delete→re-sync)
- If compensation also fails: throw CompensationError — the most critical failure mode, indicates DB-file inconsistency requiring manual intervention
- Design choice: DB-first because DB rollback is atomic; file rollback (restoring content) is fragile

## Changelog policy
- Append-only, never updated or deleted (immutable audit log)
- Records field-level changes with old/new values (JSON for complex fields like relations, tags)
- Body changes recorded as insertion marker only (no diff) — body diffs are left to version control
- Query limit: 100 entries per card (no pagination) — keeps changelog queries fast