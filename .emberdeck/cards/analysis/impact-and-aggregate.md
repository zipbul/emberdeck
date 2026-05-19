---
key: analysis/impact-and-aggregate
summary: >-
  preChangeCheck risk_level scoring, regression threshold guard, interactions
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
        A preChangeCheck call for two files that each touch exactly one card
        with low overall fan-in.
      when: preChangeCheck runs.
      then: >-
        riskLevel is low and affectedCards lists both cards with linkType
        direct.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: A repository with eight active cards and two drifted, threshold 0.3.
      when: regressionGuard runs.
      then: Exit 0 because ratio 0.25 is at or under threshold.
      covers:
        - G-002
    - id: S-H-03
      kind: happy
      given: An analyze call against a healthy repository.
      when: analyze runs.
      then: >-
        One JSON object is returned populating health, coverage, drifted,
        glossary, and unlinkedSymbols; as a hygiene side effect, code-index
        changelog entries older than the retention window are pruned.
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
      given: Two specs whose binding caches both reference the same symbol.
      when: checkInteractions runs over both keys.
      then: >-
        A sharedSymbols conflict entry is reported with the offending symbol;
        importDependencies and potentialConflicts are populated when applicable.
      covers:
        - G-003
  design:
    overview: >
      preChangeCheck walks the input files and the code_link cache to compute
      affectedCards and an aggregate riskLevel (low / medium / high / critical)
      from a tiered set of thresholds: affected-count tiers, broken-link counts,
      and a fan-in promotion step that bumps the level one tier when any touched
      file has fan-in at or above a hot-file threshold. regressionGuard compares
      the drifted/total ratio against a configured threshold (range 0 to 1).
      checkInteractions diffs the code_link cache across input keys for
      sharedSymbols, sharedFiles, importDependencies, and potentialConflicts.
      analyze composes the four read sources into one aggregate object and, as a
      hygiene side effect, prunes code-index changelog entries older than the
      configured retention window.
    components:
      - name: preChangeCheck
        responsibility: >-
          Compute affectedCards and riskLevel from a file list using
          affected-count tiers, broken-link counts, and hot-file fan-in
          promotion; surface newUncoveredFiles after ignore-pattern filtering.
        interacts_with:
          - code-binding
      - name: regressionGuard
        responsibility: >-
          Compare drifted/total ratio against a configured threshold in [0,1]
          and exit accordingly.
        interacts_with:
          - card-storage
      - name: checkInteractions
        responsibility: >-
          Detect sharedSymbols, sharedFiles, importDependencies, and
          potentialConflicts between two or more cards; unknown card keys
          produce empty entries rather than throwing.
        interacts_with:
          - code-binding
      - name: analyze
        responsibility: >-
          Aggregate health, coverage, drifted (with pagination metadata),
          glossary, and unlinkedSymbols into one JSON object; prune
          retention-aged code-index changelog entries as a hygiene side effect.
        interacts_with:
          - card-storage
          - code-binding
          - glossary
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          riskLevel is monotonic UPWARD under the COMBINATION of (a) added
          affected cards, (b) increased drift ratio of affected cards, and (c) a
          hot-file fan-in match. It is NOT a function of broken-link count in
          isolation; multiple inputs combine into the level. A hot-file fan-in
          match can only promote the level upward, never demote (applied at most
          once per call).
      - id: DI-002
        statement: >-
          regressionGuard returns the violating ratio whenever it exits
          non-zero.
  policy:
    - id: R-001
      subject: preChangeCheck
      keyword: MUST
      predicate: >-
        classify each affected card with linkType (direct or transitive) and
        apply the hot-file fan-in promotion exactly once per call.
      governs:
        - S-H-01
    - id: R-002
      subject: regressionGuard
      keyword: SHALL
      predicate: >-
        exit 2 when the drifted ratio strictly exceeds the configured threshold;
        exit 0 when ratio is at or under threshold.
      governs:
        - S-F-01
        - S-H-02
        - S-H-03
        - S-F-02
  external:
    - id: C-001
      statement: >-
        riskLevel enum and threshold semantics are jointly defined with the
        per-command shape contracts in cli-surface.
      reference:
        title: spec cli-surface/command-routing-and-output/commands/check-impact
        locator: cli-surface/command-routing-and-output/commands/check-impact
  compatibility:
    guarantees:
      - subject: preChangeCheck and regressionGuard public signatures
        version_range: 1.x
        breaks_if: riskLevel enum changes or threshold semantics change.
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
          analyze returns all five top-level data keys (health, coverage,
          drifted, glossary, unlinkedSymbols) in a single object and the
          retention-prune side effect runs without error.
        method: >-
          Snapshot test of the analyze JSON output combined with an assertion
          that retention-aged changelog entries are absent after the call.
      verifies:
        - S-H-03
        - S-H-01
        - S-H-02
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
---
