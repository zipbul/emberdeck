---
key: card-model/schema-and-validation
summary: >-
  Type-specific frontmatter and body validation enforcing the four-tier
  hierarchy and cross-reference integrity within a single card.
status: active
type: brief
parent: card-model
glossary:
  - 4-tier
  - card-key
brief:
  context:
    problem: >
      Cards arrive from CLI flags, --from YAML files, --patch payloads, and
      bulk-sync of on-disk markdown. Without strict validation the system
      accepts cards whose parent type violates the four-tier rule, whose
      required fields are missing, or whose internal cross-references (covers,
      governs, verifies, derives) point at items that do not exist on the same
      card, producing downstream drift, broken cards, and a corrupted hierarchy.
    impact:
      - statement: >-
          A single invalid card admitted to storage cascades to broken parent
          chains, broken-link drift, and failed activation guards across the
          whole card graph.
      - statement: >-
          Type-specific fields differ (principle has metric, brief has flow plus
          criteria, spec has preconditions / postconditions / invariants /
          failures); a single generic validator is insufficient and risks silent
          acceptance of nonsense.
  scope:
    goals:
      - id: G-001
        statement: >-
          Validate every card-shaped input against type-specific rules before
          any persistence happens.
      - id: G-002
        statement: >-
          Verify intra-card cross references (covers, governs, verifies,
          derives) resolve to declared list-item ids on the same card.
      - id: G-003
        statement: >-
          Enforce the four-tier hierarchy at write time so principle and domain
          are root, brief parent is domain, spec parent is brief or spec.
    non_goals:
      - id: NG-001
        statement: >-
          Validating source bindings (`@spec` annotations live in code, not on
          the card; that path is owned by code-binding).
      - id: NG-002
        statement: >-
          Validating glossary word existence in the project glossary (delegated
          to glossary domain).
    assumptions:
      - id: A-001
        statement: >-
          Every mutation path in card-lifecycle calls validation before invoking
          storage.
        verification: >-
          Grep for createCard, updateCard, bulkCreateCards entrypoints and trace
          call to validateCardInput.
        reevaluate_when: >-
          A new write entrypoint is added that bypasses ops/create or
          ops/update.
  flow:
    - id: S-H-01
      kind: happy
      given: >-
        A YAML card input with type=brief, parent=an existing domain key, all
        required brief fields populated, and self-consistent
        flow/policy/criteria cross-refs.
      when: validateCardInput runs from createCard.
      then: >-
        Validation returns success, the card persists, and no warnings are
        emitted.
      covers:
        - G-001
        - G-003
    - id: S-F-01
      kind: failure
      given: >-
        A spec card input whose policy.governs lists a flow id that does not
        appear in brief.flow on the same card.
      when: validateCardInput runs.
      then: >-
        A CardValidationError is thrown identifying the unresolved
        cross-reference, no row is written.
      covers:
        - G-002
    - id: S-F-02
      kind: failure
      given: A brief card input whose parent points at another brief.
      when: validateCardInput runs.
      then: >-
        A ParentValidationError is thrown citing the four-tier hierarchy rule
        and no row is written.
      covers:
        - G-003
  design:
    overview: >
      Validation is layered. A generic frontmatter validator checks shared
      fields (key, type, status,

      summary). Then a type-discriminated dispatcher invokes one of four body
      validators

      (principle, domain, brief, spec). Each body validator runs structural
      checks on its required

      fields and then runs intra-card cross-reference resolution. Hierarchy
      rules are checked once

      the parent card is loaded by the lifecycle layer.
    components:
      - name: validateCardInput
        responsibility: >-
          Public entry point that runs the full validation pipeline and throws
          on first error.
        interacts_with:
          - type-dispatcher
          - brief-refs-validator
          - spec-refs-validator
      - name: type-dispatcher
        responsibility: Selects the correct body validator based on the type discriminant.
        interacts_with:
          - brief-refs-validator
          - spec-refs-validator
      - name: brief-refs-validator
        responsibility: >-
          Resolves brief.flow.covers, policy.governs, criteria.verifies,
          rationale.addresses against declared ids on the same card.
        interacts_with: []
      - name: spec-refs-validator
        responsibility: >-
          Validates spec body required minimums and the `derives` format (and
          target existence when a brief lookup is supplied).
        interacts_with: []
    data_flow:
      - from: validateCardInput
        to: type-dispatcher
        payload: Normalized frontmatter object plus typed body.
        trigger: createCard or updateCard or bulkCreateCards or bulkSyncCards.
      - from: type-dispatcher
        to: brief-refs-validator
        payload: Brief body with declared list-item ids.
        trigger: type discriminant equals brief.
    invariants:
      - id: DI-001
        statement: >-
          No card is persisted unless validateCardInput returned without
          throwing.
      - id: DI-002
        statement: >-
          All declared list-item ids in a brief or spec resolve within the same
          card body before persistence.
  policy:
    - id: R-001
      subject: Every write entry point
      keyword: MUST
      predicate: invoke validateCardInput before delegating to storage repositories.
      governs:
        - S-H-01
        - S-F-01
        - S-F-02
    - id: R-002
      subject: Type-specific body validators
      keyword: SHALL
      predicate: >-
        throw a CardValidationError naming the offending field path on first
        violation.
      governs:
        - S-F-01
    - id: R-003
      subject: Parent type checks
      keyword: MUST
      predicate: >-
        throw ParentValidationError when proposed parent violates the four-tier
        hierarchy rule.
      governs:
        - S-F-02
  external:
    - id: C-001
      statement: >-
        Validation rules derive from the four-tier card taxonomy decision
        documented in the project memory.
      reference:
        title: project_card_taxonomy_evolution memory entry
        locator: >-
          /home/revil/.claude/projects/-home-revil-projects-zipbul-emberdeck/memory/project_card_taxonomy_evolution.md
  compatibility:
    guarantees:
      - subject: validateCardInput public signature
        version_range: 1.x
        breaks_if: >-
          A required field is added without a migration path for existing card
          files.
    migration_path: >-
      Use bulk-sync after schema additions; warn paths surface through
      validateCards.
  limits:
    - id: KL-001
      statement: >-
        Validators do not check whether referenced parent cards exist; that
        check is performed at storage write time.
    - id: KL-002
      statement: >-
        Cross-card relations (relations array) are not validated here;
        broken-relation warnings are produced by validateCards integrity sweep.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          An invalid type-specific cross-reference always throws
          CardValidationError before any storage call.
        method: >-
          integration test that submits a spec with policy.governs pointing at
          an undefined flow id and asserts no DB row is created.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          A brief whose parent is not a domain always throws
          ParentValidationError.
        method: integration test on createCard.
      verifies:
        - S-F-02
    - id: SC-003
      type: binary
      measure:
        predicate: A complete valid card body persists without warnings.
        method: integration test on createCard happy path.
      verifies:
        - S-H-01
  rationale:
    alternatives:
      - option: >-
          Single generic validator that accepts any object and checks only
          shared fields.
        pros:
          - Smaller code surface
          - fewer files.
        cons:
          - Type-specific cross-refs would require a second pass elsewhere
          - >-
            breaking the single-throw contract and risking silent admission of
            structurally invalid cards.
      - option: JSON-schema based validation generated from types.
        pros:
          - Externalizable schema
          - third-party tooling.
        cons:
          - >-
            JSON schema cannot express cross-reference resolution between
            sibling list-item ids
          - requiring custom logic anyway plus schema maintenance overhead.
    chosen:
      option: >-
        Hand-written, type-discriminated validators with intra-card reference
        resolution.
      reasoning: >-
        Cross-reference checks are the load-bearing invariant and must be
        expressed in code; adding JSON-schema on top would duplicate effort
        without removing the custom code.
    addresses:
      - C-001
      - KL-001
---
