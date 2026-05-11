---
key: glossary/lifecycle/remove-rename-reset
summary: >-
  removeGlossary and renameGlossary cascade across cards; resetEmberdeck wipes
  both glossary and cards.
status: draft
type: spec
parent: glossary/lifecycle
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: Caller passes a word and explicit confirmation flag.
      derives: glossary/lifecycle#G-002
  postconditions:
    - id: POST-001
      guarantee: >-
        renameGlossary atomically updates the glossary store and every
        referencing card.
      keyword: MUST
      derives: glossary/lifecycle#G-002
    - id: POST-002
      guarantee: >-
        removeGlossary marks referencing cards as drifted candidates rather than
        auto-editing them.
      keyword: SHALL
      derives: glossary/lifecycle#G-003
    - id: POST-003
      guarantee: >-
        resetEmberdeck removes all cards and glossary entries; CLI requires
        --yes.
      keyword: MUST
      derives: glossary/lifecycle#G-001
  invariants:
    - id: INV-001
      statement: >-
        Destructive ops (removeGlossary, resetEmberdeck) require explicit
        confirmation at the CLI layer.
      always_holds: per-call
  failures:
    - violation: renameGlossary target word already exists.
      behavior: Throws GlossaryValidationError; no rename performed.
---
