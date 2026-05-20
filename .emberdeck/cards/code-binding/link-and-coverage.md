---
key: code-binding/link-and-coverage
summary: >-
  Resolve cached code_link rows against the gildash index and surface symbols
  that no card covers.
status: active
type: brief
parent: code-binding
glossary:
  - codeLink
  - gildash
brief:
  context:
    problem: >
      Source `@spec` annotations are the binding source of truth; they populate
      the DB code_link cache via spec sync. Without a single resolution path
      that consumes that cache, every reader (drift, coverage, validate links)
      re-implements the gildash lookup, producing inconsistent broken-link
      counts and divergent coverage views.
    impact:
      - statement: >-
          Inconsistent link resolution gives different drift answers across
          commands, eroding trust in the analyze output.
      - statement: >-
          Without a coverage view of indexed symbols versus the code_link cache,
          important contracts go uncovered with no visibility.
  scope:
    goals:
      - id: G-001
        statement: >-
          Resolve every cached code_link row against gildash producing a valid /
          broken / ioFailed classification.
      - id: G-002
        statement: >-
          Surface symbols not bound to any card via the code_link cache so
          unowned design knowledge is visible.
    non_goals:
      - id: NG-001
        statement: Drift status transitions (delegated to analysis).
      - id: NG-002
        statement: >-
          Maintaining the source `@spec` annotations themselves (delegated to
          code-binding/annotation-roundtrip).
    assumptions:
      - id: A-001
        statement: >-
          gildash is pinned to a stable version and watch mode is disabled per
          project policy.
        verification: Inspect package.json for the pinned gildash version.
        reevaluate_when: gildash major version changes.
  flow:
    - id: S-H-01
      kind: happy
      given: >-
        A spec card whose code_link cache has three rows, all of which point at
        currently indexed symbols.
      when: validateCodeLinks runs.
      then: All three resolve as valid; broken count is zero.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: A repository with one hundred indexed symbols and cards covering eighty.
      when: getUncoveredSymbols runs.
      then: Twenty symbols are reported as uncovered.
      covers:
        - G-002
    - id: S-H-03
      kind: happy
      given: >-
        A private (non-exported) function exists with no `@spec` annotation
        anywhere in source.
      when: getUncoveredSymbols runs.
      then: The private function appears in the uncovered list.
      covers:
        - G-002
    - id: S-F-01
      kind: failure
      given: A cached code_link points at a symbol that has been removed from source.
      when: validateCodeLinks runs.
      then: >-
        The link is reported broken with the offending file plus symbol
        identified.
      covers:
        - G-001
  design:
    overview: >
      ensureReindexed maintains a fresh gildash snapshot. resolveCardCodeLinks
      reads the card's cache rows and queries gildash for symbol existence,
      returning a discriminated union (valid / broken / ioFailed).
      validateCodeLinks aggregates per-card results. getLinkCoverage and
      getUncoveredSymbols compute coverage from the same cache.
    components:
      - name: ensureReindexed
        responsibility: Trigger a gildash refresh when needed before any link query.
        interacts_with:
          - resolveCardCodeLinks
          - getUncoveredSymbols
      - name: resolveCardCodeLinks
        responsibility: >-
          Resolve each cached code_link row against gildash returning per-link
          status.
        interacts_with:
          - validateCodeLinks
      - name: validateCodeLinks
        responsibility: Aggregate link statuses into a per-card report.
        interacts_with: []
      - name: getLinkCoverage
        responsibility: Compute covered vs. total symbol counts for a single card.
        interacts_with: []
      - name: getUncoveredSymbols
        responsibility: List symbols across the project that no card's code_link cache covers.
        interacts_with: []
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          All link queries use ensureReindexed to read a current code-index
          snapshot; ensureReindexed runs at most once per runtime context
          lifetime so every link query within one ed invocation observes the
          same snapshot.
      - id: DI-002
        statement: >-
          The code_link cache is the sole inclusion test for coverage
          classification. Caller-supplied filters (kinds, files,
          excludePatterns) and project ignorePatterns may further reduce the
          result, but symbol visibility is never consulted.
  policy:
    - id: R-001
      subject: Every link or coverage entry point
      keyword: MUST
      predicate: invoke ensureReindexed before querying gildash.
      governs:
        - S-H-01
        - S-H-02
        - S-H-03
        - S-F-01
    - id: R-002
      subject: getUncoveredSymbols and suggestCardScope
      keyword: MUST
      predicate: >-
        derive inclusion from the code_link cache; symbol visibility MUST NOT
        influence the result.
      governs:
        - S-H-02
        - S-H-03
  external:
    - id: C-001
      statement: >-
        The set of code-index APIs the link-and-coverage components consume
        (reindex, getSymbolsByFile, getAffected, getDependents) is the
        integration contract; replacing the code-index dependency requires
        re-implementing only that set.
      reference:
        title: spec code-binding/link-and-coverage/resolve-and-validate
        locator: code-binding/link-and-coverage/resolve-and-validate
  compatibility:
    guarantees:
      - subject: link-and-coverage entry-point signatures
        version_range: 1.x
        breaks_if: >-
          A new major version of the underlying code-index dependency changes
          the adopted API signatures (reindex, getSymbolsByFile, getAffected,
          getDependents), or this brief reshapes its public entry points.
  limits:
    - id: KL-001
      statement: >-
        Broken-link reason is one of symbol-not-found or gildash-unavailable;
        the file-not-indexed branch declared on the BrokenLink reason union is
        reserved for future use and not currently emitted by validateCodeLinks.
    - id: KL-002
      statement: >-
        Link resolution is per-snapshot: a query returns results consistent with
        the source index captured at the runtime context's first
        ensureReindexed, which runs at most once per runtime context lifetime.
        Source edits made after that capture are not reflected within the same
        context — observing new source state requires a fresh `ed` invocation
        that rebuilds the context.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          Removing a symbol that a cached code_link points at produces a broken
          link result on the validation output.
        method: >-
          Integration test removing a bound symbol and asserting it is reported
          broken with file+symbol.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: A private function bound to no card appears in the uncovered output.
        method: >-
          Integration test asserting an unbound private function is listed as
          uncovered.
      verifies:
        - S-H-03
    - id: SC-003
      type: binary
      measure:
        predicate: >-
          Three cached links that all resolve yield a coverage result with
          broken count zero.
        method: Integration test asserting three resolving links give brokenCount=0.
      verifies:
        - S-H-01
    - id: SC-004
      type: binary
      measure:
        predicate: A project with twenty unbound symbols reports all twenty as uncovered.
        method: Integration test asserting the uncovered count equals twenty.
      verifies:
        - S-H-02
  rationale:
    alternatives:
      - option: Re-implement symbol indexing inside emberdeck.
        pros:
          - No external dep.
        cons:
          - >-
            Duplicates gildash work; conflicts with single-source-of-truth
            policy.
      - option: Resolve code_link rows via raw filesystem grep.
        pros:
          - Simple.
        cons:
          - Cannot reliably classify symbol kind without an AST
          - breaks coverage semantics.
    chosen:
      option: Delegate all symbol facts to gildash through a thin adapter.
      reasoning: Honors the single-source-of-truth integration policy.
    addresses:
      - KL-002
---
