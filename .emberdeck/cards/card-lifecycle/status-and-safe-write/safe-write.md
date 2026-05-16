---
key: card-lifecycle/status-and-safe-write/safe-write
summary: >-
  safeWriteOperation runs a forward action with compensations executed in
  reverse order on failure.
status: active
type: spec
parent: card-lifecycle/status-and-safe-write
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: Caller passes a forward action and a compensation registration callback.
      derives: card-lifecycle/status-and-safe-write#G-002
  postconditions:
    - id: POST-001
      guarantee: >-
        On forward-action throw all registered compensations execute in reverse
        registration order.
      keyword: MUST
      derives: card-lifecycle/status-and-safe-write#G-002
    - id: POST-002
      guarantee: >-
        A successful forward action returns its result without invoking
        compensations.
      keyword: SHALL
      derives: card-lifecycle/status-and-safe-write#G-002
  invariants:
    - id: INV-001
      statement: >-
        A thrown error inside safeWriteOperation results in zero observable side
        effects.
      always_holds: per-call
  failures:
    - violation: A compensation itself throws during rollback.
      behavior: >-
        safeWriteOperation throws CompensationError aggregating the original and
        compensation failures.
---
