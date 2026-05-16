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
  postconditions:
    - id: POST-001
      guarantee: >-
        bulkSyncCards reports orphan files, stale rows, and key mismatches
        without silent overwrite.
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
        stderr as card-sync-failed JSON-lines (one object per line). The
        emission is independent of the command's stdout and does not affect exit
        code (see cli-surface/command-routing-and-output/runner-and-output
        POST-004). Commands that report the same file's failure on their own
        stderr surface (e.g. `ed bulk sync`) may produce a second line; the
        runner does not deduplicate.
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
        ensureCardsSynced runs at most once per runtime context lifetime,
        mirroring the ensureReindexed caching pattern; subsequent calls return
        immediately without re-scanning.
      always_holds: cross-call
    - id: INV-003
      statement: >-
        After ensureCardsSynced returns, the indexed cache reflects the union of
        card files captured at sync time minus rows whose file was deleted.
      always_holds: per-call
    - id: INV-004
      statement: >-
        ensureCardsSynced and bulkSyncCards share the per-file syncCardFromFile
        path and the same tier-ordered upsert helper, so their wall-clock cost
        on the same fixture is within a constant factor; the persistence brief
        SC-001 (1000 cards under 5s) bounds both.
      always_holds: cross-call
    - id: INV-005
      statement: >-
        Both ensureCardsSynced and bulkSyncCards never upsert a child before its
        parent. The shared helper performs a topological sort on the
        parent-to-key edges declared in frontmatter, seeded by the set of keys
        already present in the indexed cache; this handles flat layouts, nested
        layouts, and arbitrary spec-of-spec recursion uniformly.
      always_holds: per-call
    - id: INV-006
      statement: >-
        ensureCardsSynced runs at CLI runner entry on every command, including
        before `ed bulk sync`; bulkSyncCards therefore overlaps with the
        auto-sync but adds duplicate-key detection (auto-sync is last-wins;
        bulkSyncCards reports duplicates as errors).
      always_holds: cross-call
    - id: INV-007
      statement: >-
        (key, filePath) is a bijection on the indexed-cache card table. The
        PRIMARY KEY on card.key plus the UNIQUE index on card.file_path together
        guarantee each key maps to exactly one filePath and each filePath maps
        to exactly one key at every transaction boundary. The upsert-only write
        pattern in syncCardFromFile and writeCardFile preserves the bijection
        across all writes.
      always_holds: cross-call
  failures:
    - violation: A card file's frontmatter key does not match its filename slug.
      behavior: bulkSyncCards emits a key-mismatch warning; the row is not overwritten.
    - violation: A file referenced by removeCardByFile no longer exists.
      behavior: removeCardByFile is idempotent and returns without error.
    - violation: cardsDir does not exist when ensureCardsSynced runs.
      behavior: >-
        The function returns an empty failures array silently. The cache entry
        is still recorded so subsequent calls within the same context remain
        no-ops.
    - violation: >-
        An individual card file fails to parse or upsert during
        ensureCardsSynced or bulkSyncCards.
      behavior: >-
        The error is captured into the failures array with the file path.
        ensureCardsSynced surfaces each failure as a card-sync-failed JSON-line
        on stderr. bulkSyncCards reports them in its own stdout shape's `failed`
        array. Either way the bad file stays absent from the indexed cache;
        validateCards additionally reports it as orphan-file in its own stdout.
    - violation: >-
        A parent and its child both arrive in the same bulk operation on a cold
        cache.
      behavior: >-
        The topological sort in the shared helper inserts the parent before the
        child, so the card.parent FK is always satisfied at insert time. If the
        parent itself fails to upsert (e.g. transaction error), every descendant
        FK-fails and is reported per file.
    - violation: >-
        A card file declares a parent that is neither in the indexed cache nor
        in the current sync batch.
      behavior: >-
        The file is emitted at the end of the topological order so its FK
        violation surfaces as a normal per-file failure rather than hanging the
        sync.
---
