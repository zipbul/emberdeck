---
key: card-lifecycle/status-and-safe-write/safe-write
summary: >-
  safeWriteOperation runs a synchronous dbAction then an asynchronous
  fileAction; on fileAction failure it invokes the caller-provided compensate
  callback once.
status: active
type: spec
parent: card-lifecycle/status-and-safe-write
glossary:
  - activation-guard
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes three pieces in one options object: a synchronous dbAction
        returning a value T, an asynchronous fileAction returning Promise<void>,
        and a compensate callback receiving the dbAction result T.
      derives: card-lifecycle/status-and-safe-write#G-002
  postconditions:
    - id: POST-001
      guarantee: >-
        When fileAction throws, compensate is invoked exactly once with the
        dbAction result; if compensate resolves, the original fileAction error
        is re-raised; if compensate itself throws, a CompensationError carrying
        both errors is raised in place of the original.
      keyword: MUST
      derives: card-lifecycle/status-and-safe-write#G-002
    - id: POST-002
      guarantee: >-
        When fileAction resolves, the dbAction result is returned without
        invoking compensate.
      keyword: SHALL
      derives: card-lifecycle/status-and-safe-write#G-002
  invariants:
    - id: INV-001
      statement: >-
        compensate is invoked at most once per safeWriteOperation call, and
        never after fileAction resolves.
      always_holds: per-call
  failures:
    - violation: compensate itself throws while reverting the dbAction side effect.
      behavior: >-
        safeWriteOperation throws CompensationError aggregating the original
        fileAction error and the compensate error; both error objects are
        reachable from the CompensationError instance.
    - violation: dbAction throws synchronously.
      behavior: >-
        The error propagates directly; fileAction and compensate are not
        invoked.
---
