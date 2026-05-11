---
key: card-storage/persistence/sync
summary: >-
  syncCardFromFile, bulkSyncCards, exportCardToFile, removeCardByFile, and
  validateCards reconcile cards between disk and DB.
status: draft
type: spec
parent: card-storage/persistence
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller has a runtime context with cards directory and DB connection
        initialized.
      derives: card-storage/persistence#G-002
  postconditions:
    - id: POST-001
      guarantee: >-
        bulkSyncCards reports orphan files, stale rows, and key mismatches
        without silent overwrite.
      keyword: MUST
      derives: card-storage/persistence#G-002
    - id: POST-002
      guarantee: >-
        exportCardToFile renders a DB row to canonical markdown matching the
        round-trip contract.
      keyword: SHALL
      derives: card-storage/persistence#G-003
  invariants:
    - id: INV-001
      statement: >-
        A successful bulk-sync leaves DB content equivalent to the on-disk
        directory.
      always_holds: cross-call
  failures:
    - violation: A card file's frontmatter key does not match its filename slug.
      behavior: bulkSyncCards emits a key-mismatch warning; the row is not overwritten.
    - violation: A file referenced by removeCardByFile no longer exists.
      behavior: removeCardByFile is idempotent and returns without error.
---
