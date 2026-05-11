---
key: analysis/drift-detection
summary: >-
  broken_link / glossary_broken drift classification with optional
  automatic active-to-drifted status transition.
status: draft
type: brief
parent: analysis
glossary:
  - drift
brief:
  context:
    problem: >
      Cards make claims about code (cached code_link rows that mirror source
      `@spec` annotations) and about the project glossary. Without a single
      drift query that classifies divergence into stable categories, fixes
      are reactive and inconsistent and CI cannot enforce a regression
      threshold.
    impact:
      - statement: Without classified drift the user does not know which fix to apply.
      - statement: Without auto-transition the active set silently misrepresents reality.
  scope:
    goals:
      - id: G-001
        statement: >-
          Detect the two drift types in scope: `broken_link` (a cached
          code_link no longer resolves against gildash) and
          `glossary_broken` (a card declares a glossary word the glossary
          no longer defines).
      - id: G-002
        statement: >-
          Automatically transition active cards to drifted when any drift
          type is detected, unless --no-auto-transition is passed.
    non_goals:
      - id: NG-001
        statement: Applying drift fixes (delegated to card-lifecycle).
      - id: NG-002
        statement: Drift across non-source artifacts (e.g. configs).
    assumptions:
      - id: A-001
        statement: >-
          The two drift types currently in scope are sufficient — source
          bindings live entirely in `@spec` annotations so symbol rename
          and removal both surface as broken_link on the cache.
        verification: Inspect checkDrift() in src/ops/context.ts.
        reevaluate_when: A new authoring surface for bindings is added.
  flow:
    - id: S-H-01
      kind: happy
      given: An active spec whose cached code_link rows all resolve in gildash.
      when: checkDrift runs.
      then: No drift is reported and the card stays active.
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: An active spec whose cached code_link target was removed from source.
      when: checkDrift runs without --no-auto-transition.
      then: broken_link drift is reported and the card transitions to drifted.
      covers:
        - G-001
        - G-002
    - id: S-F-02
      kind: failure
      given: A CI invocation with --no-auto-transition.
      when: drift is detected on multiple cards.
      then: Drift is reported but no status transitions occur.
      covers:
        - G-002
  design:
    overview: >
      checkDrift reads each card's cached code_link rows plus its declared
      glossary, queries gildash to verify each link, queries the glossary
      to verify each word, and classifies divergence. The primary
      driftType is reported on each card alongside the full driftTypes
      array. Auto-transition is gated by --no-auto-transition (always on
      in CI).
    components:
      - name: checkDrift
        responsibility: >-
          Detect broken_link and glossary_broken per card, classify primary
          type, optionally auto-transition.
        interacts_with:
          - card-lifecycle
      - name: per-type-detectors
        responsibility: >-
          Independent detectors for each driftType using code-binding and
          glossary outputs.
        interacts_with:
          - code-binding
          - glossary
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          --no-auto-transition disables every status mutation while still
          producing the same drift report.
  policy:
    - id: R-001
      subject: Every detector
      keyword: MUST
      predicate: produce one of the documented driftTypes.
      governs:
        - S-F-01
    - id: R-002
      subject: checkDrift
      keyword: SHALL
      predicate: not transition status when --no-auto-transition is passed.
      governs:
        - S-F-02
  external:
    - id: C-001
      statement: Drift taxonomy is co-located with the detector in src/ops/context.ts.
      reference:
        title: src/ops/context.ts
        locator: src/ops/context.ts
  compatibility:
    guarantees:
      - subject: DriftType enum
        version_range: 1.x
        breaks_if: An existing drift type is renamed.
  limits:
    - id: KL-001
      statement: >-
        Drift detection does not propose fixes; that is the user's
        responsibility.
    - id: KL-002
      statement: >-
        Auto-transition is one-way (active to drifted); recovery to active
        requires explicit set-status.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          A removed source `@spec` target produces broken_link on the next
          checkDrift after `ed spec sync`.
        method: Integration test mutating source then running checkDrift.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: '--no-auto-transition leaves status unchanged on detected drift.'
        method: CLI integration test.
      verifies:
        - S-F-02
  rationale:
    alternatives:
      - option: Single binary drift / no-drift signal.
        pros:
          - Simpler API.
        cons:
          - User cannot tell which kind of fix to apply
          - slowing repair loops.
      - option: Auto-transition always on with no opt-out.
        pros:
          - Always accurate.
        cons:
          - Breaks CI workflows that need to report without mutating state.
    chosen:
      option: Classified drift types plus opt-out flag for CI.
      reasoning: Lets CI behave non-destructively while keeping authoring loops fast.
    addresses:
      - KL-001
      - KL-002
---
