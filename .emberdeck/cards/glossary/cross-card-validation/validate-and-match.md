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
        validateCardGlossaryField iterates the card's declared glossary words
        and RETURNS the set of unresolved references — the declared words that
        are absent from the glossary store. An empty set means every declared
        word resolves. It does NOT throw for unresolved words; the drift
        detector consumes this set to report glossary_broken per card.
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
    - id: INV-002
      statement: validateCardGlossaryField never auto-modifies card content.
      always_holds: per-call
  failures:
    - violation: A glossary entry payload is malformed.
      behavior: validateGlossaryEntry throws GlossaryValidationError.
      id: FAIL-001
---
