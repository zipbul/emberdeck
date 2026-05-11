---
key: card-lifecycle/mutation-workflows/delete-rename-bulk
summary: >-
  deleteCard, renameCard, and bulkCreateCards complete the mutation set with
  cascade and rollback semantics.
status: draft
type: spec
parent: card-lifecycle/mutation-workflows
codeLinks:
  - kind: function
    file: src/ops/delete.ts
    symbol: deleteCard
  - kind: function
    file: src/ops/rename.ts
    symbol: renameCard
  - kind: function
    file: src/ops/bulk-create.ts
    symbol: bulkCreateCards
glossary:
  - 4-tier
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a card key for delete or rename, or a list of inputs for
        bulkCreate.
      binds:
        - file: src/ops/delete.ts
          symbol: deleteCard
        - file: src/ops/rename.ts
          symbol: renameCard
        - file: src/ops/bulk-create.ts
          symbol: bulkCreateCards
      derives: card-lifecycle/mutation-workflows#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        renameCard cascades parent, relations, and cross-domain dependencies in
        a single transaction.
      keyword: MUST
      binds:
        - file: src/ops/rename.ts
          symbol: renameCard
      derives: card-lifecycle/mutation-workflows#G-003
    - id: POST-002
      guarantee: bulkCreateCards rolls back all prior entries on any single failure.
      keyword: SHALL
      binds:
        - file: src/ops/bulk-create.ts
          symbol: bulkCreateCards
      derives: card-lifecycle/mutation-workflows#G-001
    - id: POST-003
      guarantee: >-
        deleteCard with --force cascades through children; without --force a
        card with children is refused.
      keyword: MUST
      binds:
        - file: src/ops/delete.ts
          symbol: deleteCard
      derives: card-lifecycle/mutation-workflows#G-001
  invariants:
    - id: INV-001
      statement: All three operations leave no partial state on failure.
      binds:
        - file: src/ops/delete.ts
          symbol: deleteCard
        - file: src/ops/rename.ts
          symbol: renameCard
        - file: src/ops/bulk-create.ts
          symbol: bulkCreateCards
      always_holds: per-call
  failures:
    - violation: deleteCard target has children and --force not passed.
      behavior: >-
        Throws ParentValidationError or CompensationError as appropriate; no
        removal.
      exception:
        class: ParentValidationError
        file: src/card/errors.ts
    - violation: renameCard target key already exists.
      behavior: Throws CardAlreadyExistsError; no rename performed.
      exception:
        class: CardAlreadyExistsError
        file: src/card/errors.ts
    - violation: bulkCreateCards mid-batch failure.
      behavior: >-
        Returns partial status; all prior entries rolled back via
        safeWriteOperation.
      exception:
        class: none
        file: src/cli/errors.ts
---
