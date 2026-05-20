---
key: card-lifecycle/status-and-safe-write/update-card-status
summary: >-
  updateCardStatus enforces the activation guard on transitions to active; it
  does not perform type changes.
status: active
type: spec
parent: card-lifecycle/status-and-safe-write
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: Caller passes a card key and target status (draft / active / drifted).
      derives: card-lifecycle/status-and-safe-write#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        A transition to active runs validateActivationGuard which re-validates
        fields and (for specs) source bindings.
      keyword: MUST
      derives: card-lifecycle/status-and-safe-write#G-001
    - id: POST-002
      guarantee: >-
        updateCardStatus accepts only the status field; it does not perform type
        changes. A separate updateCard call is required to change type;
        activation guard semantics apply only at the moment of status transition
        to 'active'.
      keyword: SHALL
      derives: card-lifecycle/status-and-safe-write#G-001
  invariants:
    - id: INV-001
      statement: >-
        No card reaches active state with unresolved required fields or broken
        source bindings.
      always_holds: per-call
  failures:
    - violation: Activation guard fails (missing field or unresolved source binding).
      behavior: updateCardStatus throws ActivationGuardError; status is not changed.
    - violation: >-
        Card with the requested key does not exist on disk or in the indexed
        cache.
      behavior: updateCardStatus throws CardNotFoundError; status is not changed.
---
