---
key: card-storage/persistence
summary: >-
  SQLite schema, repository layer, and bidirectional file-DB synchronization
  that persist cards.
status: draft
type: brief
parent: card-storage
glossary:
  - card-key
brief:
  context:
    problem: >
      Cards must round-trip between markdown files (user-editable source of
      truth) and SQLite

      (queryable index). Without a synchronization contract files and DB diverge
      silently, breaking

      list, search, drift detection, and integrity validation.
    impact:
      - statement: >-
          A stale DB row that no longer matches the file produces incorrect
          query results across every read API.
      - statement: >-
          An orphan file that never made it to the DB hides cards from
          validation and drift checks.
  scope:
    goals:
      - id: G-001
        statement: >-
          Define the SQLite schema and repository interfaces that mediate every
          card read and write.
      - id: G-002
        statement: >-
          Provide bulk-sync that reconciles a directory of card files into the
          DB and reports orphans, stale rows, and key mismatches.
      - id: G-003
        statement: >-
          Provide single-card export that materializes a DB row back to its
          on-disk form.
    non_goals:
      - id: NG-001
        statement: Mutation business logic (delegated to card-lifecycle).
      - id: NG-002
        statement: Code-link resolution against gildash (delegated to code-binding).
    assumptions:
      - id: A-001
        statement: >-
          One SQLite file per project under .emberdeck/data.db is sufficient for
          project sizes seen in benchmarks.
        verification: Inspect bench/large-scale.bench.ts for sustained card counts.
        reevaluate_when: A user reports performance issues at scale.
  flow:
    - id: S-H-01
      kind: happy
      given: A directory of N valid card files.
      when: bulkSyncCards runs.
      then: >-
        Every file becomes a DB row; orphan rows from prior state are reported
        with zero unintended deletions.
      covers:
        - G-002
    - id: S-H-02
      kind: happy
      given: A DB row for a brief card.
      when: exportCardToFile is called.
      then: A canonical markdown file is written matching the round-trip contract.
      covers:
        - G-003
    - id: S-F-01
      kind: failure
      given: A card file whose filename slug differs from the frontmatter key.
      when: bulkSyncCards processes it.
      then: A key-mismatch warning is emitted; the row is not silently overwritten.
      covers:
        - G-002
  design:
    overview: >
      The schema models cards plus relations plus classifications plus code
      links plus changelog as

      separate tables. Repositories expose narrow interfaces (CardRepository,
      RelationRepository,

      ClassificationRepository, CodeLinkRepository, ChangelogRepository) used by
      ops/ and queries.

      bulkSyncCards walks the cards directory, parses each file via card-model,
      and reconciles the

      resulting set against existing rows.
    components:
      - name: schema
        responsibility: Declares tables, indexes, and migrations including FTS5 search index.
        interacts_with:
          - CardRepository
          - RelationRepository
          - ClassificationRepository
          - CodeLinkRepository
          - ChangelogRepository
      - name: CardRepository
        responsibility: Read and write cards table including JSON-encoded body fields.
        interacts_with:
          - schema
      - name: bulkSyncCards
        responsibility: >-
          Reconcile on-disk cards directory with the DB, reporting orphan files,
          stale rows, and key mismatches.
        interacts_with:
          - CardRepository
          - schema
      - name: exportCardToFile
        responsibility: Render a DB-backed CardFile to canonical markdown on disk.
        interacts_with:
          - CardRepository
    data_flow:
      - from: bulkSyncCards
        to: CardRepository
        payload: Parsed CardFile objects keyed by slug.
        trigger: User-invoked ed bulk sync.
      - from: CardRepository
        to: exportCardToFile
        payload: CardRow plus joined sub-tables.
        trigger: User-invoked ed card export.
    invariants:
      - id: DI-001
        statement: >-
          A successful bulk-sync leaves DB content equivalent to the on-disk
          directory.
      - id: DI-002
        statement: Repository writes never bypass the schema migrations.
  policy:
    - id: R-001
      subject: bulkSyncCards
      keyword: MUST
      predicate: report key-mismatch as a warning rather than overwriting the row.
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
  external:
    - id: C-001
      statement: >-
        SQLite is used in WAL journal mode for concurrent reader safety on a
        single writer.
      reference:
        title: SQLite Write-Ahead Logging
        locator: https://www.sqlite.org/wal.html
  compatibility:
    guarantees:
      - subject: Repository public interfaces
        version_range: 1.x
        breaks_if: A method signature drops a parameter or changes return shape.
    migration_path: Schema migrations are forward-only with version tracking.
  limits:
    - id: KL-001
      statement: >-
        Concurrent writers across processes are not supported; SQLite locking is
        per-process best-effort.
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
        predicate: A key-mismatch surfaces as a warning without DB row overwrite.
        method: Integration test placing a renamed file alongside its original DB row.
      verifies:
        - S-F-01
  rationale:
    alternatives:
      - option: File-only storage with on-the-fly indexing.
        pros:
          - No DB schema to maintain.
        cons:
          - Search and drift queries become O(N) file scans
          - breaking interactive responsiveness.
      - option: External database (Postgres) instead of embedded SQLite.
        pros:
          - Multi-user.
        cons:
          - >-
            Adds a server dependency that conflicts with the single-user CLI
            deployment model.
    chosen:
      option: Embedded SQLite with WAL plus repository layer plus bulk-sync.
      reasoning: >-
        Matches single-user CLI scale, supports FTS5 for search, gives us
        transactional writes.
    addresses:
      - KL-001
      - KL-002
---
