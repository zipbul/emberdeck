---
key: card-storage/queries
summary: >-
  Read surface for cards including get, list with filters, full-text search,
  tree, context, and relation graph.
status: active
type: brief
parent: card-storage
glossary:
  - card-key
brief:
  context:
    problem: >
      Cards are read in many shapes: by exact key, by filter (type, status, tag,
      glossary, symbol, file, root subtree, updatedSince timestamp), by free
      text, by parent-child tree, by neighborhood context, and as a relation
      graph. Without a unified read surface every caller would re-implement
      joins and pagination, drifting from a single source of truth.
    impact:
      - statement: >-
          Inconsistent read surfaces produce subtly different results across the
          CLI, causing operator confusion.
      - statement: >-
          Search performance degrades quickly without an explicit index
          strategy.
  scope:
    goals:
      - id: G-001
        statement: >-
          Provide getCard, getCards (batch), listCards, searchCards,
          getCardTree, getCardContext, listCardRelations, getRelationGraph,
          findCardsByGlossaryWord, and findCardsBySymbol as the read entry
          points.
      - id: G-002
        statement: >-
          Filters compose orthogonally so combined filters return the
          intersection; CardListFilter accepts type, status, parent, tag,
          glossary, symbol, file, roots (subtree restriction), and updatedSince.
      - id: G-003
        statement: Search rejects malformed queries with a clear error.
    non_goals:
      - id: NG-001
        statement: Real-time push notifications.
      - id: NG-002
        statement: Cross-project federation.
    assumptions:
      - id: A-001
        statement: >-
          An indexed full-text search facility is available and is the backing
          store for searchCards.
        verification: Inspect schema for the search virtual-table declaration.
        reevaluate_when: >-
          A platform without an equivalent text-search facility must be
          supported.
  flow:
    - id: S-H-01
      kind: happy
      given: A list call with type=brief and status=active.
      when: listCards runs.
      then: >-
        A paginated list of brief active cards is returned with the hasMore flag
        and the explicit limit + offset values.
      covers:
        - G-001
        - G-002
    - id: S-H-02
      kind: happy
      given: A search call with a valid text-search query string.
      when: searchCards runs.
      then: A ranked list of matching cards is returned.
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: A search call with malformed search syntax.
      when: searchCards runs.
      then: An FtsSyntaxError is thrown and the runner exits 2.
      covers:
        - G-003
  policy:
    - id: R-001
      subject: searchCards
      keyword: MUST
      predicate: >-
        validate search syntax before query execution and throw FtsSyntaxError
        on failure.
      governs:
        - S-F-01
    - id: R-002
      subject: listCards filter composition
      keyword: SHALL
      predicate: >-
        behave as conjunction across orthogonal filters; --tag is mutually
        exclusive with --symbol and --glossary at the CLI layer.
      governs:
        - S-H-01
        - S-H-02
  external:
    - id: C-001
      statement: >-
        Per-command stdout shapes for the read commands (card-get, card-list,
        card-search, card-tree, card-context, card-relations) are jointly
        authored with the per-command spec cards under cli-surface.
      reference:
        title: spec cli-surface/command-routing-and-output/commands/card-list
        locator: cli-surface/command-routing-and-output/commands/card-list
  limits:
    - id: KL-001
      statement: >-
        Search relevance ranking depends on the default tokenizer;
        locale-specific tokenization is not configured.
    - id: KL-002
      statement: >-
        getRelationGraph returns at most depth-3 hops; deeper traversal is the
        responsibility of getCardContext invoked with a larger depth.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: Combined type and status filters return the intersection.
        method: Integration test that asserts filter composition behavior.
      verifies:
        - S-H-01
    - id: SC-002
      type: binary
      measure:
        predicate: A malformed search query exits 2 with FtsSyntaxError.
        method: CLI-level test invoking ed card search with a broken query.
      verifies:
        - S-F-01
    - id: SC-003
      type: binary
      measure:
        predicate: >-
          A valid full-text query returns a ranked list of matching cards (best
          match first).
        method: Integration test asserting ranked results for a known query.
      verifies:
        - S-H-02
  rationale:
    alternatives:
      - option: Single getCards multi-purpose entry point.
        pros:
          - Fewer functions.
        cons:
          - Result type cannot be tightened per use case
          - forcing every caller to handle a union.
      - option: External search engine (e.g. Meilisearch).
        pros:
          - Better relevance.
        cons:
          - Adds a server dependency.
      - option: Narrow read entry points backed by the embedded text-search facility.
        pros:
          - Result shapes precise per use case.
          - No external dependency.
        cons:
          - More functions to maintain.
          - Search relevance bounded by the embedded engine.
    chosen:
      option: Narrow read entry points backed by the embedded text-search facility.
      reasoning: >-
        Matches single-user CLI deployment and keeps result shapes precise per
        use case.
    addresses:
      - KL-001
      - KL-002
  approach: >-
    Every read returns a typed result shape rather than raw rows. Filtered
    listing composes independent filter inputs by intersection — never union —
    and surfaces explicit pagination (limit, offset, and a hasMore flag) with a
    default page size. Text search delegates to the indexed search facility
    after validating query syntax up front. Traversals are depth-bounded: the
    tree walk caps at a requested depth with a hard ceiling and marks nodes
    whose subtree was skipped, the neighborhood context defaults to the direct
    neighborhood, and the relation graph returns forward and reverse hops within
    its ceiling; truncation is surfaced explicitly whenever a traversal is cut
    short. Batch lookup collects unknown keys in a not-found list rather than
    throwing, and glossary-word and symbol listings are alternate filtered
    selections.
---
