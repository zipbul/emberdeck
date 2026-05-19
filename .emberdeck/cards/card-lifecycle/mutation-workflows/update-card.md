---
key: card-lifecycle/mutation-workflows/update-card
summary: >-
  updateCard applies summary, field, patch, glossary, and tag updates with
  replace-namespace semantics on patch; there is no body update field — body is
  derived from the namespace.
status: active
type: spec
parent: card-lifecycle/mutation-workflows
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: Caller passes a UpdateCardFields with at least one mutation field set.
      derives: card-lifecycle/mutation-workflows#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        A namespace patch fully replaces the prior namespace value with the new
        payload.
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-001
    - id: POST-002
      guarantee: >-
        Updates apply atomically across file and DB. updateCard does NOT write a
        changelog row (the changelog repo is not invoked from this path).
      keyword: SHALL
      derives: card-lifecycle/mutation-workflows#G-001
  invariants:
    - id: INV-001
      statement: >-
        updateCard re-validates inputs BEFORE merging into the existing card
        (pre-merge validation). The merged result is not re-run through
        validateCardInput after the merge; persistence relies on the per-field
        invariants enforced at the type-validator layer.
      always_holds: per-call
  failures:
    - violation: Card key not found.
      behavior: updateCard throws CardNotFoundError.
    - violation: Patch produces invalid card.
      behavior: updateCard throws CardValidationError; no persistence.
---
