---
key: card-model/schema-and-validation/card-key
summary: >-
  normalizeSlug, parseFullKey, and buildCardPath enforce the card-key slug
  grammar that gates every card identifier.
status: draft
type: spec
parent: card-model/schema-and-validation
codeLinks:
  - kind: function
    file: src/card/card-key.ts
    symbol: normalizeSlug
  - kind: function
    file: src/card/card-key.ts
    symbol: parseFullKey
  - kind: function
    file: src/card/card-key.ts
    symbol: buildCardPath
  - kind: class
    file: src/card/card-key.ts
    symbol: CardKeyError
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: Caller supplies a slug or full key string from CLI input or storage.
      binds:
        - file: src/card/card-key.ts
          symbol: parseFullKey
      derives: card-model/schema-and-validation#G-003
  postconditions:
    - id: POST-001
      guarantee: >-
        normalizeSlug rejects empty strings, relative paths, Windows drive
        paths, and double-slashes.
      keyword: MUST
      binds:
        - file: src/card/card-key.ts
          symbol: normalizeSlug
      derives: card-model/schema-and-validation#G-003
    - id: POST-002
      guarantee: >-
        buildCardPath joins cardsDir and slug producing the canonical .card.md
        path.
      keyword: SHALL
      binds:
        - file: src/card/card-key.ts
          symbol: buildCardPath
      derives: card-model/schema-and-validation#G-003
  invariants:
    - id: INV-001
      statement: Every card key persisted to storage has passed normalizeSlug.
      binds:
        - file: src/card/card-key.ts
          symbol: normalizeSlug
      always_holds: cross-call
  failures:
    - violation: Slug contains disallowed characters or path-traversal segments.
      behavior: normalizeSlug throws CardKeyError; no path constructed.
      exception:
        class: CardKeyError
        file: src/card/card-key.ts
---
