---
key: glossary/cross-card-validation/validate-and-match
summary: >-
  validateCardGlossaryField returns broken word references and
  buildGlossaryMatcher provides matching for downstream advisory checks.
status: active
type: spec
parent: glossary/cross-card-validation
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a card glossary field plus the current glossary store
        snapshot.
      derives: glossary/cross-card-validation#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        validateCardGlossaryField returns the unresolved word set without
        modifying any state.
      keyword: MUST
      derives: glossary/cross-card-validation#G-001
    - id: POST-002
      guarantee: buildGlossaryMatcher returns a matcher used for advisory body scanning.
      keyword: SHALL
      derives: glossary/cross-card-validation#G-002
  invariants:
    - id: INV-001
      statement: Validation is exclusively read-only.
      always_holds: per-call
  failures:
    - violation: A glossary entry payload is malformed.
      behavior: validateGlossaryEntry throws GlossaryValidationError.
---
