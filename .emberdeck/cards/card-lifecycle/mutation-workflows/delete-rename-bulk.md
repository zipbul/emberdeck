---
key: card-lifecycle/mutation-workflows/delete-rename-bulk
summary: >-
  deleteCard, renameCard, and bulkCreateCards complete the mutation set with
  cascade and rollback semantics.
status: active
type: spec
parent: card-lifecycle/mutation-workflows
glossary:
  - 4-tier
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a card key for delete or rename, or a list of inputs for
        bulkCreate.
      derives: card-lifecycle/mutation-workflows#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        renameCard cascades parent, relations, and cross-domain dependencies in
        a single transaction.
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-003
    - id: POST-002
      guarantee: bulkCreateCards rolls back all prior entries on any single failure.
      keyword: SHALL
      derives: card-lifecycle/mutation-workflows#G-001
    - id: POST-003
      guarantee: >-
        deleteCard with --force cascades through children; without --force a
        card with children is refused.
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-001
  invariants:
    - id: INV-001
      statement: All three operations leave no partial state on failure.
      always_holds: per-call
  failures:
    - violation: deleteCard target has children and --force not passed.
      behavior: >-
        Throws ParentValidationError or CompensationError as appropriate; no
        removal.
    - violation: renameCard target key already exists.
      behavior: Throws CardAlreadyExistsError; no rename performed.
    - violation: bulkCreateCards mid-batch failure.
      behavior: >-
        Returns partial status; all prior entries rolled back via
        safeWriteOperation.
---
