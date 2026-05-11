---
key: card-storage/persistence/db-connection
summary: >-
  createEmberdeckDb, migrateEmberdeck, and closeDb own the SQLite connection
  lifecycle and schema migrations.
status: draft
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
  failures:
    - violation: Underlying SQLite IO fails (e.g. permission denied).
      behavior: createEmberdeckDb propagates the SQLite error.
---
