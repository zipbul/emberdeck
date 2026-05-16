---
key: card-storage/persistence/db-connection
summary: >-
  createEmberdeckDb, migrateEmberdeck, and closeDb own the SQLite connection
  lifecycle and schema migrations.
status: active
type: spec
parent: card-storage/persistence
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: A SQLite-compatible filesystem path is supplied for the DB file.
      derives: card-storage/persistence#G-001
  postconditions:
    - id: POST-001
      guarantee: migrateEmberdeck applies forward-only schema migrations idempotently.
      keyword: MUST
      derives: card-storage/persistence#G-001
    - id: POST-002
      guarantee: closeDb releases the underlying SQLite handle.
      keyword: SHALL
      derives: card-storage/persistence#G-001
  invariants:
    - id: INV-001
      statement: >-
        All repository writes go through a connection produced by
        createEmberdeckDb.
      always_holds: cross-call
    - id: INV-002
      statement: >-
        The schema includes a `system_metadata` key-value table
        (cross-invocation watermark store). It currently holds one key
        `last_symbol_sync_at` written by spec-sync-symbols and read on the next
        invocation; the table exists at the schema level so future watermark
        keys can be added without migration churn.
      always_holds: cross-call
    - id: INV-003
      statement: >-
        A `system_lock` table is declared in the schema but is reserved and
        unused; cross-process advisory locking is not implemented today. The
        table stays so a future implementation does not need a schema migration;
        current behavior is single-process per the single-process-invocation
        principle.
      always_holds: cross-call
  failures:
    - violation: Underlying SQLite IO fails (e.g. permission denied).
      behavior: createEmberdeckDb propagates the SQLite error.
---
