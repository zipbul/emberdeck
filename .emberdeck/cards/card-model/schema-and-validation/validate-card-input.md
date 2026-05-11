---
key: card-model/schema-and-validation/validate-card-input
summary: >-
  validateCardInput is the gatekeeper that runs the full type-discriminated
  validation pipeline before any persistence.
status: draft
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
        validateCardInput throws CardValidationError for any invalid
        type-specific field.
      keyword: MUST
      derives: card-model/schema-and-validation#G-001
    - id: POST-002
      guarantee: >-
        Cross-references on brief and spec bodies resolve to declared list-item
        ids on the same card.
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
        Type-specific body validators select on the type discriminant
        exclusively.
      always_holds: per-call
  failures:
    - violation: A required type-specific field is missing.
      behavior: >-
        validateCardInput throws CardValidationError naming the field path; no
        persistence occurs.
    - violation: >-
        A brief.policy.governs id does not match any brief.flow id on the same
        card.
      behavior: >-
        validateBriefRefs throws CardValidationError identifying the unresolved
        id.
    - violation: >-
        A spec.preconditions.derives reference does not follow the
        `brief-key#item-id` format.
      behavior: >-
        validateSpecRefs throws CardValidationError identifying the
        malformed reference.
---
