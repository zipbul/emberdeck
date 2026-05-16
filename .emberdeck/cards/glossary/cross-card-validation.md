---
key: glossary/cross-card-validation
summary: >-
  Validate that cards reference only existing glossary words and contribute the
  glossary_broken drift signal.
status: active
type: brief
parent: glossary
glossary:
  - drift
brief:
  context:
    problem: >
      Cards declare glossary words at creation; over time the glossary store
      changes (renames,

      removes) but card declarations may not. Without ongoing cross-validation
      the project ends up

      with cards referencing terms that no longer exist, undermining the
      glossary as a single source

      of design vocabulary.
    impact:
      - statement: >-
          Stale glossary references create user confusion about what a term
          means today.
      - statement: Without a drift signal CI cannot catch broken references.
  scope:
    goals:
      - id: G-001
        statement: >-
          Provide validateCardGlossaryField that returns broken word references
          for one card.
      - id: G-002
        statement: >-
          Surface glossary_broken in the drift output of analysis when
          references are stale.
    non_goals:
      - id: NG-001
        statement: >-
          Auto-rewriting card glossary fields on rename (cascade is owned by
          glossary/lifecycle).
      - id: NG-002
        statement: Free-text scanning of card bodies for term usage.
    assumptions:
      - id: A-001
        statement: Cards declare glossary words via the glossary frontmatter field.
        verification: Inspect card-model frontmatter shape.
        reevaluate_when: A new declaration channel is added.
  flow:
    - id: S-H-01
      kind: happy
      given: A card whose glossary field lists three words all present in the store.
      when: validateCardGlossaryField runs.
      then: No broken references are reported.
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: A card whose glossary field references a word removed from the store.
      when: checkDrift runs.
      then: The card surfaces glossary_broken in driftTypes.
      covers:
        - G-002
  design:
    overview: >
      validateCardGlossaryField queries the glossary store for each declared
      word and returns the

      unresolved set. The drift detector consumes this output to report
      glossary_broken per card.
    components:
      - name: validateCardGlossaryField
        responsibility: Per-card validation of declared glossary words against the store.
        interacts_with:
          - analysis/drift-detection
      - name: buildGlossaryMatcher
        responsibility: >-
          Build a matcher used by analysis to detect glossary references in card
          bodies (advisory only).
        interacts_with: []
    data_flow: []
    invariants:
      - id: DI-001
        statement: validateCardGlossaryField never auto-modifies card content.
      - id: DI-002
        statement: glossary_broken is one of the documented two drift types.
  policy:
    - id: R-001
      subject: validateCardGlossaryField
      keyword: MUST
      predicate: be read-only; never alter cards or the glossary store.
      governs:
        - S-H-01
        - S-F-01
  external:
    - id: C-001
      statement: >-
        glossary_broken is one of the two driftTypes documented in project
        memory.
      reference:
        title: project_drift_taxonomy memory entry
        locator: >-
          /home/revil/.claude/projects/-home-revil-projects-zipbul-emberdeck/memory/project_drift_taxonomy.md
  compatibility:
    guarantees:
      - subject: validateCardGlossaryField return shape
        version_range: 1.x
        breaks_if: The broken-reference shape changes incompatibly.
  limits:
    - id: KL-001
      statement: >-
        Validation is exact-match by word; near-matches or typos are not
        surfaced as suggestions here.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          Removing a word from the store causes glossary_broken to surface on
          the next checkDrift for cards that referenced it.
        method: Integration test with a referencing card and a remove.
      verifies:
        - S-F-01
        - S-H-01
  rationale:
    alternatives:
      - option: Auto-edit card frontmatter on store changes.
        pros:
          - Always consistent.
        cons:
          - Removes user agency; opaque mutations break trust.
      - option: Drop validation entirely; rely on user discipline.
        pros:
          - Less code.
        cons:
          - Defeats the source-of-truth role of the glossary.
    chosen:
      option: Read-only validation that drives the drift signal.
      reasoning: Preserves user agency while making stale references visible.
    addresses:
      - KL-001
---
