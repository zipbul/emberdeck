---
key: card-lifecycle/mutation-workflows/create-card
summary: >-
  createCard composes validation, parent resolution, file write, DB write, and
  changelog within a safe-write boundary.
status: draft
type: spec
parent: card-lifecycle/mutation-workflows
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a CreateCardInput with key, type, summary and (for brief
        or spec) parent.
      derives: card-lifecycle/mutation-workflows#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the card persists to file and DB atomically and a changelog
        row is appended.
      keyword: MUST
      derives: card-lifecycle/mutation-workflows#G-001
    - id: POST-002
      guarantee: On parent-not-found or hierarchy violation no file or DB row is written.
      keyword: SHALL
      derives: card-lifecycle/mutation-workflows#G-002
  invariants:
    - id: INV-001
      statement: createCard validates input through card-model before any storage call.
      always_holds: per-call
  failures:
    - violation: Input fails validation.
      behavior: createCard throws CardValidationError; no file or DB row written.
    - violation: Card key already exists.
      behavior: createCard throws CardAlreadyExistsError.
    - violation: Parent key does not exist.
      behavior: createCard throws ParentValidationError.
---
