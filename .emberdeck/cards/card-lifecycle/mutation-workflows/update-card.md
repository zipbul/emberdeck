---
key: card-lifecycle/mutation-workflows/update-card
summary: >-
  updateCard applies field, patch, body, glossary, and tag updates with
  replace-namespace semantics on patch.
status: draft
type: spec
parent: card-lifecycle/mutation-workflows
codeLinks:
  - kind: function
    file: src/ops/update.ts
    symbol: updateCard
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: Caller passes a UpdateCardFields with at least one mutation field set.
      binds:
        - file: src/ops/update.ts
          symbol: updateCard
      derives: card-lifecycle/mutation-workflows#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        A namespace patch fully replaces the prior namespace value with the new
        payload.
      keyword: MUST
      binds:
        - file: src/ops/update.ts
          symbol: updateCard
      derives: card-lifecycle/mutation-workflows#G-001
    - id: POST-002
      guarantee: Updates apply atomically across file and DB and produce a changelog row.
      keyword: SHALL
      binds:
        - file: src/ops/update.ts
          symbol: updateCard
      derives: card-lifecycle/mutation-workflows#G-001
  invariants:
    - id: INV-001
      statement: updateCard re-runs validation after applying patches before persisting.
      binds:
        - file: src/ops/update.ts
          symbol: updateCard
      always_holds: per-call
  failures:
    - violation: Card key not found.
      behavior: updateCard throws CardNotFoundError.
      exception:
        class: CardNotFoundError
        file: src/card/errors.ts
    - violation: Patch produces invalid card.
      behavior: updateCard throws CardValidationError; no persistence.
      exception:
        class: CardValidationError
        file: src/card/errors.ts
---
