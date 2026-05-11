---
key: card-lifecycle/status-and-safe-write/update-card-status
summary: >-
  updateCardStatus enforces the activation guard on transitions to active and
  the type-change activation rules.
status: draft
type: spec
parent: card-lifecycle/status-and-safe-write
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a card key and target status (draft / active / drifted /
        retired).
      derives: card-lifecycle/status-and-safe-write#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        A transition to active runs validateActivationGuard which re-validates
        fields and codeLinks.
      keyword: MUST
      derives: card-lifecycle/status-and-safe-write#G-001
    - id: POST-002
      guarantee: A type change combined with activation re-runs the type-specific guard.
      keyword: SHALL
      derives: card-lifecycle/status-and-safe-write#G-001
  invariants:
    - id: INV-001
      statement: >-
        No card reaches active state with unresolved required fields or broken
        codeLinks.
      always_holds: per-call
  failures:
    - violation: Activation guard fails (missing field or unresolved codeLink).
      behavior: updateCardStatus throws ActivationGuardError; status is not changed.
---
