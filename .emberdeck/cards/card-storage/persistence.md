---
key: card-storage/persistence
summary: >-
  Indexed cache schema, repository layer, and bidirectional file-DB
  synchronization that persist cards.
status: active
type: brief
parent: card-storage
glossary:
  - card-key
brief:
  context:
    problem: >-
      Card files (.emberdeck/cards/**.md) are the user-editable source of truth;
      The indexed cache is a derived store that makes list/search/drift queries
      O(1) instead of O(N file scans). For the cache to be safe to read, it must
      always reflect the files at the moment a command starts — otherwise reads
      return lies whenever a user edits a card file externally (IDE, git
      checkout, scripted edit) without first running a manual sync.
    impact:
      - statement: >-
          A stale DB row that no longer matches the file produces incorrect
          query results across every read API.
      - statement: >-
          An orphan file that never made it to the DB hides cards from
          validation and drift checks.
      - statement: >-
          Requiring users to remember `ed bulk sync` before every read turns the
          SSOT principle into a footgun.
  scope:
    goals:
      - id: G-001
        statement: >-
          Define the indexed cache schema and repository interfaces that mediate
          every card read and write.
      - id: G-002
        statement: >-
          Provide bulk-sync that reconciles a directory of card files into the
          DB — deleting stale rows (whose file is gone) and upserting existing
          files. Orphan-file / stale-row detection-reporting and frontmatter-key
          vs path-slug mismatch detection are surfaced by validateCards, not by
          bulk-sync.
      - id: G-003
        statement: >-
          Provide single-card export that materializes a DB row back to its
          on-disk form.
      - id: G-004
        statement: >-
          Guarantee that the DB cache reflects card files at the start of every
          CLI invocation via an automatic file-to-DB sync, so command logic can
          read DB freely without separate freshness checks.
    non_goals:
      - id: NG-001
        statement: Mutation business logic (delegated to card-lifecycle).
      - id: NG-002
        statement: Code-link resolution against gildash (delegated to code-binding).
      - id: NG-003
        statement: >-
          Real-time file watching. Freshness is guaranteed at command start, not
          for the entire process lifetime.
    assumptions:
      - id: A-001
        statement: >-
          One embedded store file per project under .emberdeck/data.db is
          sufficient for project sizes seen in benchmarks.
        verification: Inspect bench/large-scale.bench.ts for sustained card counts.
        reevaluate_when: A user reports performance issues at scale.
  flow:
    - id: S-H-01
      kind: happy
      given: A directory of N valid card files.
      when: bulkSyncCards runs.
      then: >-
        Every file becomes a DB row and stale rows from prior state are deleted,
        with zero unintended deletions of valid rows; per-file parse/IO failures
        are returned in failed[].
      covers:
        - G-002
    - id: S-H-02
      kind: happy
      given: A DB row for a brief card.
      when: exportCardToFile is called.
      then: A canonical markdown file is written matching the round-trip contract.
      covers:
        - G-003
    - id: S-H-03
      kind: happy
      given: >-
        A card file edited externally (IDE save, git checkout) between two CLI
        invocations.
      when: The next CLI command starts (any subcommand).
      then: >-
        ensureCardsSynced absorbs the change into the DB before command logic
        runs; the command observes the new file content with no manual `ed bulk
        sync` required.
      covers:
        - G-004
    - id: S-H-04
      kind: happy
      given: >-
        A repository write through CardRepository.upsert followed by a read
        through CardRepository.findByKey.
      when: Both calls run within the same context.
      then: >-
        The read returns the row exactly as written, with all JSON-encoded body
        fields decoded via the shared json-fields helper.
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: A card file whose filename slug differs from the frontmatter key.
      when: bulkSyncCards processes it.
      then: >-
        The file is upserted under its frontmatter key and an unrelated DB row
        is not silently overwritten; the key-vs-slug mismatch itself is NOT
        flagged by bulk-sync — validateCards surfaces it separately as a
        fileLevelIssues key-mismatch entry.
      covers:
        - G-002
  policy:
    - id: R-001
      subject: bulkSyncCards
      keyword: MUST
      predicate: >-
        upsert each file under its frontmatter key without overwriting an
        unrelated row, and leave key-vs-slug mismatch reporting to validateCards
        rather than emitting it here.
      governs:
        - S-F-01
    - id: R-002
      subject: Repository implementations
      keyword: SHALL
      predicate: >-
        encode JSON body fields through the shared json-fields helper to keep
        encoding consistent.
      governs:
        - S-H-01
        - S-H-02
        - S-H-04
    - id: R-003
      subject: The CLI runner
      keyword: MUST
      predicate: >-
        invoke ensureCardsSynced after buildRuntime and before delegating to the
        command function, so every command observes a DB consistent with the
        on-disk files at command start.
      governs:
        - S-H-03
    - id: R-004
      subject: ensureCardsSynced
      keyword: MUST
      predicate: >-
        tolerate a missing cardsDir as a no-op so `ed init` and post-`ed reset`
        runs do not fail at the sync step.
      governs:
        - S-H-03
  external:
    - id: C-001
      statement: >-
        The embedded store runs in a journaling mode that lets concurrent
        readers see a consistent snapshot while a single writer commits.
      reference:
        title: SQLite Write-Ahead Logging
        locator: https://www.sqlite.org/wal.html
  limits:
    - id: KL-001
      statement: >-
        Concurrent writers across processes are not supported; the store-level
        locking is per-process best-effort.
    - id: KL-002
      statement: >-
        Schema changes require a migration; ad-hoc table edits are not
        supported.
  criteria:
    - id: SC-001
      type: numeric
      measure:
        predicate: bulkSyncCards on a directory of one thousand cards completes within
        value: 5
        comparator: <=
        unit: seconds
        reference: bench/large-scale.bench.ts
      verifies:
        - S-H-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          A file whose frontmatter key differs from its path slug is upserted
          under its frontmatter key without overwriting an unrelated DB row, and
          bulk-sync emits no key-mismatch diagnostic (validateCards surfaces it
          instead).
        method: Integration test placing a renamed file alongside its original DB row.
      verifies:
        - S-F-01
    - id: SC-003
      type: binary
      measure:
        predicate: >-
          External file edits, additions, and deletions are reflected on the
          next CLI invocation without manual `ed bulk sync`.
        method: e2e (test/cli/fs-race.test.ts) covers all three cases.
      verifies:
        - S-H-03
    - id: SC-004
      type: binary
      measure:
        predicate: >-
          exportCardToFile produces output that re-parses to a structurally
          equivalent CardFile (round-trip).
        method: Snapshot/round-trip integration test in test/ops/sync.test.ts.
      verifies:
        - S-H-02
    - id: SC-005
      type: binary
      measure:
        predicate: >-
          CardRepository.upsert followed by findByKey returns a CardRow whose
          JSON body fields decode back to the values that were written.
        method: Repository unit test using a temp DB.
      verifies:
        - S-H-04
  rationale:
    alternatives:
      - option: File-only storage with on-the-fly indexing.
        pros:
          - No DB schema to maintain.
        cons:
          - Search and drift queries become O(N) file scans
          - breaking interactive responsiveness.
      - option: >-
          An external database server (e.g. Postgres) instead of the embedded
          store.
        pros:
          - Multi-user.
        cons:
          - >-
            Adds a server dependency that conflicts with the single-user CLI
            deployment model.
    chosen:
      option: >-
        Embedded database with concurrent-reader safety plus repository layer
        plus bulk-sync plus auto-sync at CLI entry
      reasoning: >-
        Matches single-user CLI scale, supports indexed full-text search, gives
        us transactional writes, and keeps file-as-SSOT contract invisible to
        read commands.
    addresses:
      - KL-001
      - KL-002
  approach: >-
    Storage models cards and their relations, classifications, code bindings,
    and changelog as separate tables behind narrow repository interfaces. Card
    files are the source of truth and the database is a cache derived from them;
    on any discrepancy detected during sync, the files win. Two sync paths share
    one per-file reconciliation: an automatic file-to-cache sync runs once at
    command entry so external edits become visible to that invocation, and an
    explicit bulk sync reconciles the whole directory, deleting stale rows and
    upserting existing files while returning per-file parse and IO failures
    rather than aborting. A successful bulk sync leaves the cache equivalent to
    the on-disk directory, and after the automatic sync returns every later read
    in that invocation observes a cache consistent with the files captured at
    sync time. All writes go through a single connection whose schema is brought
    up to date by forward-only migrations, and export renders a cache-backed
    card back to canonical markdown.
---
