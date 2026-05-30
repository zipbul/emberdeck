---
key: card-model/schema-and-validation/card-key
summary: >-
  normalizeSlug, parseFullKey, and buildCardPath enforce the card-key slug
  grammar that gates every card identifier.
status: active
type: spec
parent: card-model/schema-and-validation
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: Caller supplies a slug or full key string from CLI input or storage.
      derives: card-model/schema-and-validation#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        normalizeSlug rejects empty strings, relative paths, Windows drive
        paths, and double-slashes.
      keyword: MUST
      derives: card-model/schema-and-validation#G-001
    - id: POST-002
      guarantee: >-
        buildCardPath joins cardsDir and slug producing the canonical `.md`
        card-file path.
      keyword: SHALL
      derives: card-model/schema-and-validation#G-001
  invariants:
    - id: INV-001
      statement: Every card key persisted to storage has passed normalizeSlug.
      always_holds: cross-call
  failures:
    - violation: Slug contains disallowed characters or path-traversal segments.
      behavior: normalizeSlug throws CardKeyError; no path constructed.
      id: FAIL-001
---
