---
key: card-model/schema-and-validation/validate-card-input
summary: >-
  validateCardInput is the gatekeeper that runs the full type-discriminated
  validation pipeline before any persistence.
status: active
type: spec
parent: card-model/schema-and-validation
glossary:
  - 4-tier
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        A ValidationInput object is constructed from frontmatter and body before
        validation.
      derives: card-model/schema-and-validation#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        validateCardInput throws CardValidationError for any invalid common
        field — key TYPE (string check) and LENGTH (≤ LIMITS.KEY_MAX), type
        discriminant, summary type+length, parent reference shape. NOTE: key
        FORMAT (slug grammar, path-traversal, double-slash) is NOT enforced here
        — it is owned by `card-model/schema-and-validation/card-key` via
        `normalizeSlug` invoked at the storage layer.
      keyword: MUST
      derives: card-model/schema-and-validation#G-001
    - id: POST-002
      guarantee: >-
        validateCardInput verifies COMMON fields only. Type-specific deep
        namespace validation (brief.flow.covers, spec.derives, etc.) is
        delegated to dedicated validators (validateBriefRefs, validateSpecRefs)
        invoked separately by the op layer. These deeper validators are GATED by
        status: they run for cards being created/updated as status='active' (or
        transitioning to active), and they are SKIPPED for draft cards. A draft
        card can therefore persist with unresolved deeper cross-refs; the gate
        fires only at the activation boundary.
      keyword: SHALL
      derives: card-model/schema-and-validation#G-002
  invariants:
    - id: INV-001
      statement: >-
        validateCardInput is invoked before any storage write and throws on
        first violation.
      always_holds: per-call
    - id: INV-002
      statement: >-
        Type-specific deeper validators (cross-ref resolution,
        flow/policy/criteria/derives integrity) are invoked by the op layer
        AFTER validateCardInput common-field validation passes AND only when
        status='active' or the operation transitions to active. Draft
        create/update intentionally bypasses the deeper validation pass.
      always_holds: per-call
  failures:
    - violation: >-
        A required common field (key, type, summary, parent for non-root types)
        is missing, of the wrong type, or exceeds length limits.
      behavior: >-
        validateCardInput throws CardValidationError naming the field path; no
        persistence occurs. Key SLUG-FORMAT violations (path traversal,
        double-slash) surface separately at the card-key layer via normalizeSlug
        → CardKeyError.
    - violation: >-
        A brief.policy.governs id does not match any brief.flow id on the same
        card (cross-ref) — only checked when status='active' or transitioning to
        active.
      behavior: >-
        validateBriefRefs (separate validator) throws CardValidationError
        identifying the unresolved id.
    - violation: >-
        A spec.preconditions.derives reference does not follow the
        `brief-key#item-id` format — only checked when status='active' or
        transitioning to active.
      behavior: >-
        validateSpecRefs (separate validator) throws CardValidationError
        identifying the malformed reference.
    - violation: >-
        The validation input carries a top-level frontmatter key outside the
        closed CardFrontmatter set (key, summary, status, type, parent,
        relations, tags, glossary, principle, domain, brief, spec) — e.g. a
        legacy codeLinks/boundary field or a typo.
      behavior: >-
        validateCardInput throws CardValidationError naming the unknown key(s);
        no card is persisted. validateCardInput is the shared enforcement point
        for all mutation entry paths (create, update, bulk sync), so
        closed-schema rejection holds uniformly across them.
---
