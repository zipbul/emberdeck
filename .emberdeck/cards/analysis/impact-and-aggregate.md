---
key: analysis/impact-and-aggregate
summary: >-
  preChangeCheck risk_level scoring, regression threshold guard, interactions
  conflict detection, and analyze aggregate.
status: draft
type: brief
parent: analysis
glossary:
  - drift
brief:
  context:
    problem: >
      Before changing files the user wants to know what cards are affected and
      at what risk level.

      After a batch of changes CI needs to fail when drifted ratio crosses a
      threshold. When two

      cards reference the same code symbol the user wants to see the conflict
      explicitly. None of

      these can be answered by per-card drift alone.
    impact:
      - statement: Without preChangeCheck the user proceeds blind to scope of impact.
      - statement: Without regression threshold CI cannot gate merges on health.
  scope:
    goals:
      - id: G-001
        statement: >-
          Provide preChangeCheck producing risk_level and affected_cards for a
          list of files.
      - id: G-002
        statement: >-
          Provide regressionGuard that fails when drifted ratio exceeds a
          configured threshold.
      - id: G-003
        statement: >-
          Provide checkInteractions that surfaces shared symbol or shared file
          conflicts between cards.
      - id: G-004
        statement: >-
          Provide analyze that aggregates health, coverage, drift, glossary and
          unlinked symbols.
    non_goals:
      - id: NG-001
        statement: Real-time monitoring of changes.
      - id: NG-002
        statement: Suggesting which cards to fix first beyond risk_level ordering.
    assumptions:
      - id: A-001
        statement: >-
          Files passed to preChangeCheck use repo-relative paths matching
          gildash conventions.
        verification: Inspect impact.ts path normalization.
        reevaluate_when: Path conventions change.
  flow:
    - id: S-H-01
      kind: happy
      given: A preChangeCheck call for two files that touch one card each.
      when: preChangeCheck runs.
      then: risk_level low and affected_cards list both cards with linkType direct.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: A repository with eight active cards and two drifted, threshold 0.3.
      when: regressionGuard runs.
      then: Exit 0 because ratio 0.2 is under threshold.
      covers:
        - G-002
    - id: S-H-03
      kind: happy
      given: An analyze call with healthy state.
      when: analyze runs.
      then: >-
        One JSON envelope is returned with health, coverage, drift, glossary,
        and unlinked_symbols populated.
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
      given: Two specs with overlapping codeLinks pointing at the same symbol.
      when: checkInteractions runs over both keys.
      then: A shared-symbol conflict entry is reported with the offending symbol.
      covers:
        - G-003
  design:
    overview: >
      preChangeCheck walks files plus boundary plus codeLinks to compute
      affected_cards and an

      aggregate risk_level (low / medium / high / critical). regressionGuard
      uses card-storage

      counts plus a project threshold. checkInteractions diffs codeLinks plus
      boundary plus imports

      across input keys for shared elements. analyze composes the four read
      sources into one

      aggregate envelope.
    components:
      - name: preChangeCheck
        responsibility: Compute affected cards and risk_level from a file list.
        interacts_with:
          - code-binding
      - name: regressionGuard
        responsibility: Compare drifted ratio against threshold and exit accordingly.
        interacts_with:
          - card-storage
      - name: checkInteractions
        responsibility: >-
          Detect shared symbol, file, or import conflicts between two or more
          cards.
        interacts_with:
          - code-binding
      - name: analyze
        responsibility: >-
          Aggregate health, coverage, drift, glossary, and unlinked_symbols into
          one JSON envelope.
        interacts_with:
          - card-storage
          - code-binding
          - glossary
    data_flow: []
    invariants:
      - id: DI-001
        statement: risk_level is monotonic in affected_count and broken-link count.
      - id: DI-002
        statement: >-
          regressionGuard always returns the violating ratio when it exits
          non-zero.
  policy:
    - id: R-001
      subject: preChangeCheck
      keyword: MUST
      predicate: >-
        classify each affected card with linkType (direct / boundary /
        transitive).
      governs:
        - S-H-01
    - id: R-002
      subject: regressionGuard
      keyword: SHALL
      predicate: exit 2 when the drifted ratio exceeds the configured threshold.
      governs:
        - S-F-01
  external:
    - id: C-001
      statement: >-
        Threshold semantics align with the analyze and check coverage outputs in
        the response shapes contract.
      reference:
        title: emberdeck SKILL response_shapes section
        locator: >-
          /home/revil/projects/zipbul/emberdeck/.claude/skills/emberdeck/SKILL.md
  compatibility:
    guarantees:
      - subject: preChangeCheck and regressionGuard public signatures
        version_range: 1.x
        breaks_if: risk_level enum changes or threshold semantics change.
  limits:
    - id: KL-001
      statement: >-
        risk_level is heuristic; it ranks suggested attention but is not a
        formal guarantee.
    - id: KL-002
      statement: >-
        checkInteractions is pairwise per call; multi-way conflict graphs
        require multiple invocations.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: regressionGuard exits 2 when ratio exceeds threshold.
        method: CLI integration test against a fixture with controlled ratios.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: checkInteractions detects a shared symbol across two specs.
        method: Integration test with two specs sharing a codeLink target.
      verifies:
        - S-F-02
    - id: SC-003
      type: binary
      measure:
        predicate: analyze returns all five top-level data keys in a single envelope.
        method: Snapshot test of the analyze JSON envelope.
      verifies:
        - S-H-03
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
          - Conflicts with the gildash pinned non-watch policy.
    chosen:
      option: >-
        Discrete entry points sharing a common card-storage and code-binding
        base.
      reasoning: Each entry has a different exit-code contract and CI use case.
    addresses:
      - KL-001
      - KL-002
---
