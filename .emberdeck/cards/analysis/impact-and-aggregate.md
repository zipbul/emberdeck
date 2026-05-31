---
key: analysis/impact-and-aggregate
summary: >-
  preChangeCheck riskLevel scoring, regression threshold guard, interactions
  conflict detection, and analyze aggregate.
status: active
type: brief
parent: analysis
glossary:
  - drift
brief:
  context:
    problem: >
      Before changing files the user wants to know what cards are affected and
      at what risk level. After a batch of changes CI needs to fail when the
      drifted ratio crosses a threshold. When two cards reference the same code
      symbol the user wants to see the conflict explicitly. None of these can be
      answered by per-card drift alone.
    impact:
      - statement: Without preChangeCheck the user proceeds blind to scope of impact.
      - statement: Without regression threshold CI cannot gate merges on health.
  scope:
    goals:
      - id: G-001
        statement: >-
          Provide preChangeCheck producing riskLevel and affectedCards for a
          list of files.
      - id: G-002
        statement: >-
          Provide regressionGuard that fails when drifted ratio exceeds a
          configured threshold.
      - id: G-003
        statement: >-
          Provide checkInteractions that surfaces shared-symbol, shared-file,
          and import-dependency conflicts between cards.
      - id: G-004
        statement: >-
          Provide analyze that aggregates health, coverage, drifted cards,
          glossary, and unlinkedSymbols.
    non_goals:
      - id: NG-001
        statement: Real-time monitoring of changes.
      - id: NG-002
        statement: Suggesting which cards to fix first beyond riskLevel ordering.
    assumptions:
      - id: A-001
        statement: >-
          Files passed to preChangeCheck use repo-relative paths matching
          code-index conventions.
        verification: Inspect impact.ts path normalization.
        reevaluate_when: Path conventions change.
  flow:
    - id: S-H-01
      kind: happy
      given: >-
        A preChangeCheck call for ZERO affected cards (no input file maps to any
        card, OR all touched cards have empty code_link cache).
      when: preChangeCheck runs.
      then: riskLevel is `low` and affectedCards is empty.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: A repository with eight cards, two of them drifted, threshold 0.3.
      when: regressionGuard runs.
      then: Exit 0 because ratio 0.25 is at or under threshold.
      covers:
        - G-002
    - id: S-H-03
      kind: happy
      given: An analyze call against a healthy repository.
      when: analyze runs.
      then: >-
        One JSON object is returned populating health, coverage, driftedCards,
        driftedCardsTotal, glossary, and unlinkedSymbols; as a hygiene side
        effect, code-index changelog entries older than the retention window are
        pruned.
      covers:
        - G-004
    - id: S-F-01
      kind: failure
      given: A regressionGuard call where drifted ratio exceeds threshold.
      when: regressionGuard runs.
      then: Exit code 2 and the violating ratio is reported.
      covers:
        - G-002
    - id: S-F-02
      kind: failure
      given: Two specs whose code_link caches both reference the same symbol.
      when: checkInteractions runs over both keys.
      then: >-
        A sharedSymbols conflict entry is reported with the offending symbol;
        importDependencies and potentialConflicts are populated when applicable.
      covers:
        - G-003
    - id: S-H-04
      kind: happy
      given: >-
        A preChangeCheck call for a change affecting several cards, including a
        file with a hot-file fan-in match.
      when: preChangeCheck runs.
      then: >-
        Each affected card is classified with a linkType (direct/transitive) and
        riskLevel is promoted above low per the combined inputs (the fan-in
        match applied at most once).
      covers:
        - G-001
  policy:
    - id: R-001
      subject: preChangeCheck
      keyword: MUST
      predicate: >-
        classify each affected card with linkType (direct or transitive) and
        apply the hot-file fan-in promotion exactly once per call.
      governs:
        - S-H-01
        - S-H-04
    - id: R-002
      subject: regressionGuard
      keyword: SHALL
      predicate: >-
        exit 2 when the drifted ratio strictly exceeds the configured threshold;
        exit 0 when ratio is at or under threshold.
      governs:
        - S-F-01
        - S-H-02
    - id: R-003
      subject: analyze
      keyword: MUST
      predicate: >-
        aggregate health, coverage, drifted cards, glossary, and unlinkedSymbols
        into one read-only object without mutating card status.
      governs:
        - S-H-03
    - id: R-004
      subject: checkInteractions
      keyword: MUST
      predicate: >-
        surface shared-symbol, shared-file, and import interactions plus
        conflicts for the supplied card pair.
      governs:
        - S-F-02
  external:
    - id: C-001
      statement: >-
        riskLevel enum and threshold semantics are jointly defined with the
        per-command shape contracts in cli-surface.
      reference:
        title: spec cli-surface/command-routing-and-output/commands/check-impact
        locator: cli-surface/command-routing-and-output/commands/check-impact
  limits:
    - id: KL-001
      statement: >-
        riskLevel is heuristic; it ranks suggested attention but is not a formal
        guarantee.
    - id: KL-002
      statement: >-
        checkInteractions is pairwise per call; multi-way conflict graphs
        require multiple invocations.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: regressionGuard exits 2 when ratio strictly exceeds threshold.
        method: CLI integration test against a fixture with controlled ratios.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          checkInteractions detects a shared symbol across two specs and
          populates importDependencies and potentialConflicts when applicable.
        method: Integration test with two specs whose binding caches share a target.
      verifies:
        - S-F-02
    - id: SC-003
      type: binary
      measure:
        predicate: >-
          analyze returns the top-level data keys (health, coverage,
          driftedCards, driftedCardsTotal, glossary, unlinkedSymbols) in a
          single object and the retention-prune side effect runs without error.
        method: >-
          Snapshot test of the analyze JSON output combined with an assertion
          that retention-aged changelog entries are absent after the call.
      verifies:
        - S-H-03
    - id: SC-004
      type: binary
      measure:
        predicate: >-
          preChangeCheck on zero affected cards returns riskLevel low and an
          empty affectedCards list.
        method: Integration test asserting low/empty for a no-op change set.
      verifies:
        - S-H-01
    - id: SC-005
      type: binary
      measure:
        predicate: >-
          regressionGuard exits 0 when the drifted ratio is at or under the
          configured threshold.
        method: Integration test asserting exit 0 for ratio <= threshold.
      verifies:
        - S-H-02
    - id: SC-006
      type: binary
      measure:
        predicate: >-
          A change affecting several cards with a hot-file fan-in match yields
          riskLevel above low and per-card linkType classification.
        method: >-
          Integration test asserting raised riskLevel + linkType for a
          multi-card fan-in change.
      verifies:
        - S-H-04
  rationale:
    alternatives:
      - option: Composite single command (analyze + impact + regression in one call).
        pros:
          - Fewer commands.
        cons:
          - Loses precision of CI exit codes from regressionGuard.
      - option: Real-time watcher.
        pros:
          - Always-on feedback.
        cons:
          - >-
            Conflicts with the pinned non-watch policy for the code-index
            dependency.
    chosen:
      option: >-
        Discrete entry points sharing a common card-storage and code-binding
        base.
      reasoning: Each entry has a different exit-code contract and CI use case.
    addresses:
      - KL-001
      - KL-002
  approach: >-
    Four read-only analyses compose into one aggregate. Impact analysis walks
    the changed files and the cached bindings to compute the affected cards and
    a risk level drawn from tiered thresholds — affected-count tiers and
    broken-link counts — with a hot-file fan-in match promoting the level one
    tier upward at most once; the risk level is monotonic upward and never
    demoted by any single input. The regression guard compares the
    drifted-to-total ratio against a configured threshold in the unit range and
    returns the violating ratio when it fails. Interaction analysis diffs the
    cached bindings across two or more cards for shared symbols, shared files,
    import dependencies, and potential conflicts, treating unknown keys as empty
    rather than errors. The aggregate composer gathers health, coverage, the
    drifted list and its total, glossary, and unlinked symbols into one object,
    and as a hygiene side effect prunes code-index changelog entries older than
    the retention window.
---
