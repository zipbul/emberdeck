---
key: glossary/lifecycle
summary: >-
  Define, lookup, remove, and rename glossary entries with cascading updates to
  cards that reference them.
status: draft
type: brief
parent: glossary
glossary:
  - drift
brief:
  context:
    problem: >
      Glossary terms are project-specific design decisions referenced from many
      cards. Without a

      managed lifecycle a remove leaves orphan references; a rename forces
      manual edits across

      every card; a define without uniqueness checks admits duplicates.
    impact:
      - statement: >-
          Orphan references after a remove cause glossary-broken drift across
          many cards at once.
      - statement: >-
          Manual rename of a term across dozens of cards is error-prone and easy
          to skip partially.
  scope:
    goals:
      - id: G-001
        statement: >-
          Provide define, lookup, remove, rename entry points with
          all-or-nothing batch semantics on define (≤50).
      - id: G-002
        statement: >-
          Cascade renames so the glossary field on every referencing card
          updates atomically.
      - id: G-003
        statement: >-
          Mark referencing cards drifted on remove rather than silently breaking
          them.
    non_goals:
      - id: NG-001
        statement: Cross-project glossary federation.
      - id: NG-002
        statement: >-
          Auto-suggesting glossary additions (delegated to analysis
          suggestions).
    assumptions:
      - id: A-001
        statement: Glossary persistence is suitable for hundreds of entries per project.
        verification: Inspect glossary/io.ts storage and benchmarks.
        reevaluate_when: A user reports performance issues at scale.
  flow:
    - id: S-H-01
      kind: happy
      given: A define call with ten valid entries.
      when: defineGlossary runs.
      then: All ten are persisted in one batch and lookup returns them.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: A glossary entry referenced by three cards.
      when: renameGlossary runs.
      then: >-
        The entry name updates and all three cards have their glossary field
        updated atomically.
      covers:
        - G-002
    - id: S-F-01
      kind: failure
      given: A define batch where one of the entries is invalid.
      when: defineGlossary runs.
      then: >-
        All entries in the batch are rejected (all-or-nothing); no partial
        persistence.
      covers:
        - G-001
    - id: S-F-02
      kind: failure
      given: A remove call without --yes flag.
      when: removeGlossary runs.
      then: The CLI requires confirmation; nothing is removed without --yes.
      covers:
        - G-003
  design:
    overview: >
      defineGlossary writes the YAML glossary file plus DB cache. renameGlossary
      issues an atomic

      update across the glossary file and every card glossary field that
      references the old word.

      removeGlossary requires explicit --yes and reports referencing cards as
      drifted candidates.
    components:
      - name: defineGlossary
        responsibility: All-or-nothing batch define with size cap (≤50).
        interacts_with:
          - lookupGlossary
      - name: lookupGlossary
        responsibility: Read entries by word or list all.
        interacts_with: []
      - name: removeGlossary
        responsibility: Confirmation-gated remove that surfaces affected cards.
        interacts_with:
          - renameGlossary
      - name: renameGlossary
        responsibility: Atomic rename across glossary store and card glossary fields.
        interacts_with:
          - defineGlossary
    data_flow: []
    invariants:
      - id: DI-001
        statement: defineGlossary is all-or-nothing per batch.
      - id: DI-002
        statement: removeGlossary never runs without explicit --yes.
  policy:
    - id: R-001
      subject: defineGlossary
      keyword: SHALL
      predicate: >-
        cap each batch at fifty entries and reject the whole batch on any single
        invalid entry.
      governs:
        - S-H-01
        - S-F-01
    - id: R-002
      subject: removeGlossary
      keyword: MUST
      predicate: require explicit --yes confirmation before any persistence change.
      governs:
        - S-F-02
    - id: R-003
      subject: renameGlossary
      keyword: MUST
      predicate: cascade card glossary fields atomically with the glossary store update.
      governs:
        - S-H-02
  external:
    - id: C-001
      statement: >-
        Glossary lifecycle commands and confirmation contract are documented in
        the SKILL command table.
      reference:
        title: emberdeck SKILL commands section
        locator: >-
          /home/revil/projects/zipbul/emberdeck/.claude/skills/emberdeck/SKILL.md
  compatibility:
    guarantees:
      - subject: Glossary store file format
        version_range: 1.x
        breaks_if: A new required field is added without a migration path.
  limits:
    - id: KL-001
      statement: Define batch size cap is fifty per call; larger imports must be chunked.
    - id: KL-002
      statement: >-
        Remove cascades to drifted but does not auto-edit card glossary fields;
        manual repair is expected.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          A define batch with one invalid entry leaves zero new persisted
          entries.
        method: Integration test asserting count before and after.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          A rename atomically updates the glossary store and every referencing
          card.
        method: Integration test creating three referencing cards then renaming.
      verifies:
        - S-H-02
  rationale:
    alternatives:
      - option: Per-entry define (no batch).
        pros:
          - Simpler atomicity model.
        cons:
          - Bulk imports become slow and partially-applied on failure.
      - option: Auto-cascade remove (delete references silently).
        pros:
          - No drifted state.
        cons:
          - Hides intent; user loses visibility into who was using a term.
    chosen:
      option: >-
        Batched define with size cap, confirmation-gated remove that surfaces
        affected cards.
      reasoning: >-
        Matches the all-or-nothing contract documented in commands and respects
        user agency on destructive ops.
    addresses:
      - KL-001
      - KL-002
---
