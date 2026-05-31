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
      Cards arrive from CLI flags, --from JSON files, --patch payloads, and
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
          Validate every card-shaped input against the COMMON-field rules (key
          TYPE+LENGTH+FORMAT (slug grammar), type discriminant, summary, parent
          shape) AND a CLOSED frontmatter schema (only key, summary, status,
          type, parent, relations, tags, glossary, principle, domain, brief,
          spec are permitted; any other top-level key is rejected, never
          silently dropped) before any persistence happens. Deeper type-specific
          rules (brief flow/policy/criteria cross-refs, spec derives format) are
          gated at the ACTIVATION boundary — they run only for cards being
          persisted as status=active or transitioning to active; draft
          persistence intentionally bypasses the deep pass.
      - id: G-002
        statement: >-
          Verify intra-card cross references resolve to declared list-item ids
          on the same card: covers, governs, verifies, and rationale.addresses
          on briefs; derives on specs.
      - id: G-003
        statement: >-
          Enforce the four-tier hierarchy at write time so principle and domain
          are root, brief parent is domain, and spec parent is brief or spec;
          reject type changes that would orphan or mis-tier any direct child.
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
          Grep for createCard, updateCard, bulkCreateCards entry points and
          trace the call to validateCardInput.
        reevaluate_when: >-
          A new write entry point is added that bypasses ops/create or
          ops/update.
  flow:
    - id: S-H-01
      kind: happy
      given: >-
        A card input with type=brief, parent=an existing domain key, all
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
        A brief card persisted as (or transitioning to) active whose
        policy.governs lists a flow id that does not appear in brief.flow on the
        same card.
      when: >-
        the activation-gated deep validation runs (the op layer invokes the
        brief-refs validator for an active card).
      then: >-
        A CardValidationError is thrown identifying the unresolved
        cross-reference; no row is written. (A draft card bypasses this deep
        pass.)
      covers:
        - G-002
    - id: S-F-02
      kind: failure
      given: >-
        A brief card input whose parent points at another brief, or an
        updateCard call that changes a domain's type to brief when the domain
        has active children.
      when: validateCardInput or validateChildrenHierarchy runs.
      then: >-
        A ParentValidationError is thrown citing the four-tier hierarchy rule
        and no row is written.
      covers:
        - G-003
    - id: S-F-03
      kind: failure
      given: >-
        A card input whose frontmatter carries a top-level key outside the
        closed CardFrontmatter set (e.g. a legacy codeLinks or boundary field,
        or a typo'd field name).
      when: validateCardInput runs.
      then: >-
        A CardValidationError is thrown naming the unknown key(s); no row is
        written and the unknown key is not silently discarded.
      covers:
        - G-001
  policy:
    - id: R-001
      subject: Every write entry point
      keyword: MUST
      predicate: >-
        invoke validateCardInput common-field validation before delegating to
        storage repositories. The deeper type-specific validators
        (validateBriefRefs, validateSpecRefs) are invoked separately by the op
        layer and are gated by status=active.
      governs:
        - S-H-01
        - S-F-01
        - S-F-02
    - id: R-002
      subject: Type-specific body validators
      keyword: SHALL
      predicate: >-
        throw a single CardValidationError listing every offending field path;
        do not abort on the first violation.
      governs:
        - S-F-01
    - id: R-003
      subject: Hierarchy checks
      keyword: MUST
      predicate: >-
        throw ParentValidationError when a proposed parent (on create) or a
        proposed type change (on update) violates the four-tier hierarchy rule.
      governs:
        - S-F-02
    - id: R-004
      subject: Common-field validation
      keyword: MUST
      predicate: >-
        reject any frontmatter top-level key outside the closed CardFrontmatter
        set with a CardValidationError that names the offending key(s), rather
        than silently dropping it; this enforces the source-as-binding-sot
        principle by making a stray codeLinks/boundary field a hard validation
        failure.
      governs:
        - S-F-03
  external:
    - id: C-001
      statement: >-
        Per-validator contract shape is jointly authored with the
        validate-card-input spec card.
      reference:
        title: spec card-model/schema-and-validation/validate-card-input
        locator: card-model/schema-and-validation/validate-card-input
  limits:
    - id: KL-001
      statement: >-
        Validators do not check whether referenced parent cards exist; that
        check is performed at storage write time.
    - id: KL-002
      statement: >-
        Relation target EXISTENCE is checked at write time (a relations entry
        pointing at a non-existent card throws CardValidationError before
        persistence); broken-relation DRIFT — a target removed after the card
        was written — is surfaced separately by the validate-cards integrity
        sweep, not re-checked on every mutation.
    - id: KL-003
      statement: >-
        Maximum field lengths are enforced numerically: summary at most 300
        chars, card key at most 200 chars, array items at most 100 entries, each
        relation target at most 200 chars, body at most 100000 chars, list-item
        content fields (e.g. statement, condition, guarantee) at most 100 chars.
        Violations surface as CardValidationError before persistence.
    - id: KL-004
      statement: >-
        Parent-chain ancestor traversal is bounded at 20 hops; cycle detection
        within the four-tier hierarchy is unreachable in practice but the bound
        prevents pathological loops in case of accidental graph corruption.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          An invalid type-specific cross-reference on a card persisted as (or
          transitioning to) active always throws CardValidationError before any
          storage call, listing every unresolved reference; a draft card with
          the same input is not deep-validated.
        method: >-
          Integration test that submits a brief with policy.governs pointing at
          multiple undefined flow ids and asserts both ids are named in the
          error.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          A brief whose parent is not a domain always throws
          ParentValidationError; a type change on a domain to brief with active
          children throws ParentValidationError naming the children.
        method: Two integration tests on createCard and updateCard.
      verifies:
        - S-F-02
    - id: SC-003
      type: binary
      measure:
        predicate: A complete valid card body persists without warnings.
        method: Integration test on the createCard happy path.
      verifies:
        - S-H-01
    - id: SC-004
      type: binary
      measure:
        predicate: >-
          Submitting a card whose frontmatter includes a codeLinks (or any other
          unknown top-level) key always throws CardValidationError naming that
          key before any storage call; the key is never accepted and never
          silently stripped.
        method: >-
          Integration test that submits a card input with a codeLinks
          frontmatter field and asserts CardValidationError names codeLinks and
          that no row was written.
      verifies:
        - S-F-03
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
  approach: >-
    Validation is layered. A common pass first checks the shared frontmatter
    fields — key grammar and length, the type discriminant, summary, parent
    shape, and the closed frontmatter schema — failing on the first violation. A
    type-discriminated second pass then runs the body validator for the card
    type; for brief and spec cards this resolves every declared cross-reference
    (flow against goals, policy against flow, criteria against flow, rationale
    against external and limits, and spec derives against brief items) and
    reports all violations together rather than aborting on the first. The deep
    cross-reference pass is status-gated: it runs only when a card is persisted
    as active or transitions to active, so draft cards can be saved
    incrementally. Hierarchy rules are enforced once the parent is known, and a
    type change on an existing card re-validates every direct child against the
    four-tier rule.
---
