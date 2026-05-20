---
key: card-storage/persistence/db-connection
summary: >-
  createEmberdeckDb, migrateEmberdeck, and closeDb own the embedded store
  connection lifecycle and schema migrations.
status: active
type: spec
parent: card-storage/persistence
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: A writable filesystem path is supplied for the DB file.
      derives: card-storage/persistence#G-001
  postconditions:
    - id: POST-001
      guarantee: migrateEmberdeck applies forward-only schema migrations idempotently.
      keyword: MUST
      derives: card-storage/persistence#G-001
    - id: POST-002
      guarantee: closeDb releases the underlying store handle.
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
        A cross-invocation key-value watermark store holds one key
        `last_symbol_sync_at` written by spec-sync-symbols and read on the next
        invocation; it accommodates future watermark keys without structural
        change.
      always_holds: cross-call
    - id: INV-003
      statement: >-
        An advisory cross-process lock capability is reserved but unused today;
        cross-process locking is not implemented. Current behavior is
        single-process per the single-process-invocation principle.
      always_holds: cross-call
  failures:
    - violation: Underlying store IO fails (e.g. permission denied).
      behavior: createEmberdeckDb propagates the underlying store error.
---
