---
key: single-file-test-rule
summary: >-
  An invariant becomes a card only when verifying it requires reading more than
  one source file.
status: active
type: principle
glossary:
  - single-file-rule
principle:
  statement: >-
    An invariant SHALL be expressed as a card only when discovering or verifying
    it requires reading more than one source file; single-file invariants MUST
    stay in code.
  rationale: >-
    Card mass drives validation cost and reviewer burden. Mirroring every
    single-file contract as a card produces 1-to-1 docstring duplication,
    brittle drift, and no semantic gain over the code itself. Cross-file
    invariants on the other hand cannot be expressed by code alone and earn
    their place as cards. This rule keeps card density aligned with the system
    value cards provide.
  applies_to:
    - card-authoring
  enforcement: advisory
---
