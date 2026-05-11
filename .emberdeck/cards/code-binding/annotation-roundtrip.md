---
key: code-binding/annotation-roundtrip
summary: >-
  Source @spec annotation scan into DB code_link rows plus rename/move
  propagation so the cache tracks the live source.
status: draft
type: brief
parent: code-binding
glossary:
  - codeLink
  - spec-annotation
brief:
  context:
    problem: >
      Source is the binding source of truth: every `/** @spec card-key */`
      JSDoc tag in code declares one binding. The DB `code_link` table is a
      cache of that scan so queries (drift, coverage, impact) don't reparse
      source every call. Without a sync the cache drifts from source. Symbol
      renames or moves invalidate cache rows unless explicitly tracked.
    impact:
      - statement: >-
          A new `@spec` tag added in source is invisible to drift / coverage
          / impact until the cache is reconciled.
      - statement: >-
          A symbol rename without sync silently breaks every cached link
          targeting the old name.
  scope:
    goals:
      - id: G-001
        statement: Reconstruct the DB code_link cache from `@spec` annotations in source.
      - id: G-002
        statement: >-
          Propagate gildash-detected symbol renames or moves into existing
          code_link cache rows.
    non_goals:
      - id: NG-001
        statement: Detecting drift (delegated to analysis).
      - id: NG-002
        statement: Writing annotations back into source (source is authored manually).
      - id: NG-003
        statement: Editing source semantics beyond the JSDoc parse step.
    assumptions:
      - id: A-001
        statement: Source files are TypeScript-compatible JSDoc carriers.
        verification: Inspect spec-sync.ts annotation parsing.
        reevaluate_when: A non-TS language is added to scope.
  flow:
    - id: S-H-01
      kind: happy
      given: A source file containing two `@spec` annotations not present in the DB cache.
      when: syncSpecAnnotations runs.
      then: The two missing rows are added to the corresponding card's code_link cache.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: gildash reports that symbol foo moved from a.ts to b.ts.
      when: syncSymbolChanges runs.
      then: >-
        The cache row updates from {file:a.ts,symbol:foo} to
        {file:b.ts,symbol:foo}.
      covers:
        - G-002
    - id: S-F-01
      kind: failure
      given: A `@spec` annotation referencing a card key that does not exist.
      when: syncSpecAnnotations runs.
      then: >-
        The annotation is reported as unmatched (no cache row written); CLI
        returns a partial-status envelope with `UNMATCHED_ANNOTATION`.
      covers:
        - G-001
  design:
    overview: >
      syncSpecAnnotations parses source for `@spec` tags and reconciles the
      DB code_link table — adding missing rows, leaving existing rows alone,
      and reporting annotations whose card key is unknown. syncSymbolChanges
      queries gildash for renames and moves since a stored watermark and
      applies the diff to the cache.
    components:
      - name: syncSpecAnnotations
        responsibility: Read `@spec` tags from source and reconcile DB code_link rows.
        interacts_with:
          - syncSymbolChanges
      - name: syncSymbolChanges
        responsibility: Apply gildash-reported renames and moves to code_link rows.
        interacts_with:
          - syncSpecAnnotations
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          The DB code_link cache is a derived view; it is never the input to
          source generation.
      - id: DI-002
        statement: >-
          syncSpecAnnotations is idempotent — re-running with no source
          change leaves the cache byte-identical.
  policy:
    - id: R-001
      subject: syncSpecAnnotations
      keyword: MUST
      predicate: report unmatched annotations rather than silently dropping them.
      governs:
        - S-F-01
    - id: R-002
      subject: syncSymbolChanges
      keyword: SHALL
      predicate: only apply changes reported by gildash (no heuristic guesses).
      governs:
        - S-H-02
  external:
    - id: C-001
      statement: JSDoc tag conventions follow standard TypeScript JSDoc parsing.
      reference:
        title: TypeScript JSDoc Reference
        locator: >-
          https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html
  compatibility:
    guarantees:
      - subject: Annotation tag format
        version_range: 1.x
        breaks_if: The `@spec` tag syntax changes incompatibly.
  limits:
    - id: KL-001
      statement: >-
        syncSymbolChanges only sees what gildash reports; out-of-band edits
        are invisible until a reindex.
    - id: KL-002
      statement: >-
        The cache snapshot at any moment reflects only annotations that were
        present at the most recent sync — newly added `@spec` tags require a
        re-run.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          syncSpecAnnotations on a source set with no annotation changes
          since the previous run produces zero `created` rows.
        method: Integration test asserting created=0 on idempotent re-run.
      verifies:
        - S-H-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          An `@spec missing-card` annotation surfaces as an
          `UNMATCHED_ANNOTATION` partial-status entry.
        method: CLI test asserting the partial envelope.
      verifies:
        - S-F-01
  rationale:
    alternatives:
      - option: Card-side codeLinks list as source of truth.
        pros:
          - Bindings are queryable without parsing source.
        cons:
          - Two SoTs drift apart; reviewing code can't tell which contracts apply
          - Forces an awkward second authoring surface (the codeLinks list) parallel to the code itself.
      - option: Parse source on every drift query (no cache).
        pros:
          - No reconciliation step.
        cons:
          - Every query pays the parse cost
          - drift / coverage / impact become O(source-size) instead of O(matched-cards).
    chosen:
      option: Source-as-SoT with a sync-maintained DB cache.
      reasoning: >-
        The annotation lives next to the code so reviewers see the contract.
        The cache buys query latency without changing the SoT.
    addresses:
      - KL-001
      - KL-002
---
