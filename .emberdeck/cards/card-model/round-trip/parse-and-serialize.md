---
key: card-model/round-trip/parse-and-serialize
summary: >-
  parseCardMarkdown and serializeCardMarkdown form the canonical round-trip used
  by sync, export, and bulk-create.
status: draft
type: spec
parent: card-model/round-trip
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Input text is a UTF-8 markdown document with YAML frontmatter delimited
        by triple-dash.
      derives: card-model/round-trip#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        serializeCardMarkdown applied to parseCardMarkdown output is idempotent
        on the second pass.
      keyword: MUST
      derives: card-model/round-trip#G-001
    - id: POST-002
      guarantee: >-
        parseCardMarkdown throws on malformed YAML rather than returning a
        partial CardFile.
      keyword: SHALL
      derives: card-model/round-trip#G-002
  invariants:
    - id: INV-001
      statement: >-
        serializeCardMarkdown emits a canonical key ordering per type so
        equivalent inputs produce identical bytes.
      always_holds: per-call
  failures:
    - violation: YAML frontmatter is syntactically invalid.
      behavior: >-
        parseCardMarkdown throws a parse error identifying the offending
        position; no CardFile is returned.
---
