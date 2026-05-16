---
key: card-model/schema-and-validation/parent-and-hierarchy
summary: >-
  Parent existence, type, and cycle checks plus children hierarchy enforce the
  four-tier rule at write time.
status: active
type: spec
parent: card-model/schema-and-validation
glossary:
  - 4-tier
spec:
  preconditions:
    - id: PRE-001
      condition: A proposed parent key is supplied for brief or spec creation or update.
      derives: card-model/schema-and-validation#G-003
  postconditions:
    - id: POST-001
      guarantee: A brief whose parent is not a domain throws ParentValidationError.
      keyword: MUST
      derives: card-model/schema-and-validation#G-003
    - id: POST-002
      guarantee: >-
        A parent reassignment that would create a cycle throws
        ParentValidationError.
      keyword: SHALL
      derives: card-model/schema-and-validation#G-003
  invariants:
    - id: INV-001
      statement: All four hierarchy checks complete before any storage mutation.
      always_holds: per-call
  failures:
    - violation: Proposed parent does not exist in storage.
      behavior: validateParentExists throws ParentValidationError.
    - violation: Proposed parent type violates the four-tier rule.
      behavior: validateParentType throws ParentValidationError.
    - violation: relations entry references a non-existent card.
      behavior: >-
        validateRelationTargets throws CardValidationError naming the missing
        target.
---
