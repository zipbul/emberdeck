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
  design:
    overview: >
      Each read returns a typed result shape. listCards composes WHERE clauses
      from independent filter inputs and surfaces explicit limit, offset, and
      hasMore in its result envelope (default limit is 50). searchCards
      delegates to the indexed text-search facility with explicit syntax
      validation up front. getCardTree caps traversal at depth (default 10,
      capped at 20) and exposes a truncated marker on nodes whose unvisited
      subtree was skipped. getCardContext defaults to depth 1 at both ops and
      CLI layers. getRelationGraph defaults to depth 3 and returns forward +
      reverse hops within that ceiling. getCards is the batch read variant:
      unknown keys are returned in notFound[] rather than throwing.
      findCardsByGlossaryWord and findCardsBySymbol are alternate filtered
      listings selected by the CLI --glossary / --symbol flags (mutually
      exclusive with --tag).
    components:
      - name: getCard
        responsibility: Single-card lookup with optional history.
        interacts_with:
          - getCardContext
      - name: getCards
        responsibility: >-
          Batch lookup; unknown keys are collected in notFound[] rather than
          throwing.
        interacts_with:
          - getCard
      - name: listCards
        responsibility: >-
          Filtered list with composable predicates and explicit pagination
          (default limit 50).
        interacts_with: []
      - name: searchCards
        responsibility: Text-search-backed search with explicit syntax check and ranking.
        interacts_with: []
      - name: getCardTree
        responsibility: >-
          Parent-child traversal capped at depth (default 10, capped at 20) with
          truncated markers.
        interacts_with: []
      - name: getCardContext
        responsibility: >-
          Neighborhood traversal (parent BFS plus relations) capped at depth
          (default 1 at both ops and CLI layers).
        interacts_with:
          - getCard
      - name: getRelationGraph
        responsibility: Forward and reverse relations within a depth ceiling (default 3).
        interacts_with: []
      - name: findCardsByGlossaryWord
        responsibility: >-
          Listing variant that selects every card whose glossary field contains
          the given word.
        interacts_with:
          - listCards
      - name: findCardsBySymbol
        responsibility: >-
          Listing variant that selects every card whose binding cache references
          the given symbol.
        interacts_with:
          - listCards
    data_flow: []
    invariants:
      - id: DI-001
        statement: Filter composition is intersection (AND), never union.
      - id: DI-002
        statement: >-
          Tree and context traversals respect their depth ceilings (tree
          min(req, 20) default 10; context default 1 at both ops and CLI;
          relation graph default 3) and surface truncation explicitly when a
          traversal is cut short by its ceiling on the depth>1 path; context at
          its default depth 1 returns the direct neighborhood with no truncation
          marker.
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
  compatibility:
    guarantees:
      - subject: Read entry-point public signatures
        version_range: 1.x
        breaks_if: A required filter is added without a default.
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
---
