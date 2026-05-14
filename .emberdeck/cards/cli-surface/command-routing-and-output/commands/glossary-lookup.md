---
key: cli-surface/command-routing-and-output/commands/glossary-lookup
summary: >-
  ed glossary lookup [word] emits {entries:[{word,definition}], total} per C2 list shape;
  single-word and no-word forms share the shape so consumers never branch on input form.
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        glossary file exists at the configured path (created by `ed init`).
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        success stdout JSON shape (C2 list, paginated):

        ```
        {
          entries: { word: string, definition: string }[],
          total:   number                          // entries.length
        }
        ```

        Single-word form returns a 1-element array on hit, 0-element on miss.
        No-word form returns all glossary entries.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        exit code policy: always 0 (read-only).
      keyword: SHALL
      derives: cli-surface/command-routing-and-output#G-002
    - id: POST-003
      guarantee: >-
        --quiet does not change the shape (D19).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-005
  invariants:
    - id: INV-001
      statement: >-
        Single shape regardless of args (C2 invariant). Old `{found, entry}` branch
        is removed; a missing word produces `{entries:[], total:0}`, not a thrown error.
      always_holds: cross-call
  failures:
    - violation: glossary file is malformed YAML.
      behavior: >-
        GlossaryParseError → stderr `GLOSSARY_PARSE_ERROR` JSON-line; exit 2.
---
