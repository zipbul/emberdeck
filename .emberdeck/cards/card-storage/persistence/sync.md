---
key: card-storage/persistence/sync
summary: >-
  ensureCardsSynced (auto file-to-DB sync at CLI entry with surfaced per-file
  failures), syncCardFromFile, bulkSyncCards, exportCardToFile, and
  validateCards reconcile cards between disk and DB.
status: active
type: spec
parent: card-storage/persistence
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller has a runtime context with cards directory and indexed-cache
        connection initialized.
      derives: card-storage/persistence#G-002
    - id: PRE-002
      condition: >-
        For ensureCardsSynced: the runtime context's cardsDir path is
        configured. The directory itself may or may not exist on disk.
      derives: card-storage/persistence#G-004
    - id: PRE-003
      condition: >-
        For exportCardToFile: a card key is supplied that resolves to an
        existing indexed-cache row.
      derives: card-storage/persistence#G-003
  postconditions:
    - id: POST-001
      guarantee: >-
        bulkSyncCards reconciles the cards directory into the DB: it deletes
        stale rows (file gone) and upserts existing files, returning per-file
        parse/IO failures in failed[]. It does NOT detect or report orphan files
        or stale rows as a diagnostic — orphan-file and stale-db-row are
        surfaced by validateCards' fileLevelIssues, as is frontmatter-key vs
        filename-slug mismatch.
      keyword: MUST
      derives: card-storage/persistence#G-002
    - id: POST-002
      guarantee: >-
        exportCardToFile renders an indexed-cache row to canonical markdown
        matching the round-trip contract.
      keyword: SHALL
      derives: card-storage/persistence#G-003
    - id: POST-003
      guarantee: >-
        ensureCardsSynced first removes indexed-cache rows whose filePath is no
        longer present on disk, then upserts every existing card file via the
        shared tier-ordered upsert path. The function is a no-op if invoked
        again on the same context.
      keyword: MUST
      derives: card-storage/persistence#G-004
    - id: POST-004
      guarantee: >-
        ensureCardsSynced returns successfully when cardsDir does not exist; no
        rows are deleted in that case.
      keyword: MUST
      derives: card-storage/persistence#G-004
    - id: POST-005
      guarantee: >-
        Per-file sync failures inside ensureCardsSynced (parse error, I/O error)
        do not abort the remaining files. The function returns the failures as
        an array of (filePath, error) pairs so the CLI runner can stream them to
        stderr as card-sync-failed JSON-lines.
      keyword: MUST
      derives: card-storage/persistence#G-004
  invariants:
    - id: INV-001
      statement: >-
        A successful bulk-sync leaves indexed-cache content equivalent to the
        on-disk directory.
      always_holds: cross-call
    - id: INV-002
      statement: >-
        ensureCardsSynced runs at most once per runtime context lifetime;
        subsequent calls return immediately without re-scanning.
      always_holds: cross-call
    - id: INV-003
      statement: >-
        After ensureCardsSynced returns, the indexed cache reflects the union of
        card files captured at sync time minus rows whose file was deleted.
      always_holds: per-call
    - id: INV-004
      statement: >-
        ensureCardsSynced and bulkSyncCards share the per-file syncCardFromFile
        path and the same tier-ordered upsert helper; the persistence brief
        SC-001 (1000 cards under 5s) bounds both.
      always_holds: cross-call
    - id: INV-005
      statement: >-
        Both ensureCardsSynced and bulkSyncCards never upsert a child before its
        parent (topological sort on parent-to-key edges).
      always_holds: per-call
    - id: INV-006
      statement: >-
        ensureCardsSynced runs at CLI runner entry on every command;
        bulkSyncCards therefore overlaps with the auto-sync but adds
        duplicate-key detection: when two files declare the same key, the second
        is rejected into failed[] rather than upserted, preserving the (key,
        filePath) bijection of INV-007.
      always_holds: cross-call
    - id: INV-007
      statement: (key, filePath) is a bijection on the indexed-cache card table.
      always_holds: cross-call
  failures:
    - violation: A file referenced by removeCardByFile no longer exists.
      behavior: removeCardByFile is idempotent and returns without error.
      id: FAIL-001
    - violation: cardsDir does not exist when ensureCardsSynced runs.
      behavior: The function returns an empty failures array silently.
      id: FAIL-002
    - violation: >-
        An individual card file fails to parse or upsert during
        ensureCardsSynced or bulkSyncCards.
      behavior: >-
        The error is captured into the failures array with the file path.
        ensureCardsSynced surfaces each failure as a card-sync-failed JSON-line
        on stderr. bulkSyncCards reports them in its own stdout shape's `failed`
        array.
      id: FAIL-003
    - violation: >-
        A parent and its child both arrive in the same bulk operation on a cold
        cache.
      behavior: >-
        The topological sort inserts the parent before the child. If the parent
        fails to upsert, every descendant fails its parent-reference check and
        is reported per file.
      id: FAIL-004
    - violation: >-
        A card file declares a parent that is neither in the indexed cache nor
        in the current sync batch.
      behavior: >-
        The file is emitted at the end of the topological order so its
        parent-reference violation surfaces as a normal per-file failure rather
        than hanging the sync.
      id: FAIL-005
    - violation: >-
        exportCardToFile is called with a key that does not resolve to any
        indexed-cache row.
      behavior: exportCardToFile throws CardNotFoundError; no output file is created.
      id: FAIL-006
    - violation: >-
        exportCardToFile encounters a serialization or file-write error after
        the row was fetched.
      behavior: >-
        exportCardToFile throws a generic Error (or the underlying serializer
        error); no partial file is left behind (safe-write boundary).
      id: FAIL-007
---
