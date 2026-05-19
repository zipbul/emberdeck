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
        field (key format, type, summary, parent reference shape).
      keyword: MUST
      derives: card-model/schema-and-validation#G-001
    - id: POST-002
      guarantee: >-
        validateCardInput verifies COMMON fields only. Type-specific deep
        namespace validation (brief.flow.covers, spec.derives, etc.) is
        delegated to dedicated validators (validateBriefRefs, validateSpecRefs)
        invoked separately by the op layer, NOT by validateCardInput itself.
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
        AFTER validateCardInput common-field validation passes.
      always_holds: per-call
  failures:
    - violation: >-
        A required common field (key, type, summary, parent for non-root types)
        is missing or malformed.
      behavior: >-
        validateCardInput throws CardValidationError naming the field path; no
        persistence occurs.
    - violation: >-
        A brief.policy.governs id does not match any brief.flow id on the same
        card (cross-ref).
      behavior: >-
        validateBriefRefs (separate validator) throws CardValidationError
        identifying the unresolved id.
    - violation: >-
        A spec.preconditions.derives reference does not follow the
        `brief-key#item-id` format.
      behavior: >-
        validateSpecRefs (separate validator) throws CardValidationError
        identifying the malformed reference.
---
