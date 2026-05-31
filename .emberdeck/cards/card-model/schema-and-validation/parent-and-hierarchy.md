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
        Cycle detection walks the parent chain up to a fixed depth limit
        (currently 20 hops). A reassignment that would create a cycle whose loop
        closes WITHIN 20 hops throws ParentValidationError. Cycles whose loop
        length exceeds 20 hops are NOT detected by this guard — they slip
        through and surface later (e.g. via `ed validate cards` cycle
        reporting).
      keyword: SHALL
      derives: card-model/schema-and-validation#G-003
    - id: POST-003
      guarantee: >-
        A type change on a card that has children re-validates the children's
        tiering (validateChildrenHierarchy): if the new type would leave any
        direct child mis-tiered (e.g. changing a domain to brief while it has
        children parented to it), ParentValidationError is thrown and the type
        change is rejected.
      keyword: MUST
      derives: card-model/schema-and-validation#G-003
  invariants:
    - id: INV-001
      statement: All four hierarchy checks complete before any storage mutation.
      always_holds: per-call
    - id: INV-002
      statement: >-
        On a type change to an existing card, the type-vs-parent relationship of
        every direct child is re-validated; a type change that would make any
        child invalid under the new parent type is rejected.
      always_holds: per-call
  failures:
    - violation: Proposed parent does not exist in storage.
      behavior: validateParentExists throws ParentValidationError.
      id: FAIL-001
      case_of: card-model/schema-and-validation#S-F-02
    - violation: Proposed parent type violates the four-tier rule.
      behavior: validateParentType throws ParentValidationError.
      id: FAIL-002
      case_of: card-model/schema-and-validation#S-F-02
    - violation: relations entry references a non-existent card.
      behavior: >-
        validateRelationTargets throws CardValidationError naming the missing
        target.
      id: FAIL-003
    - violation: Parent reassignment creates a cycle whose loop length is ≤ 20 hops.
      behavior: >-
        validateParentCycle throws ParentValidationError. Cycles with loop
        length > 20 escape this guard.
      id: FAIL-004
      case_of: card-model/schema-and-validation#S-F-02
    - violation: >-
        A type change would mis-tier an existing direct child (the child's
        parent-type rule would break).
      behavior: >-
        validateChildrenHierarchy throws ParentValidationError; the type change
        is not applied.
      id: FAIL-005
      case_of: card-model/schema-and-validation#S-F-02
---
