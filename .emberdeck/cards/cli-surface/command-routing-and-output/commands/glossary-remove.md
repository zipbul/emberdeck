---
key: cli-surface/command-routing-and-output/commands/glossary-remove
summary: >-
  ed glossary remove <word> emits {removed, word, affected_card_keys} per C3 single mutation;
  `word` field identifies the mutated entity (sibling consistency with glossary-rename).
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        --yes is required for non-TTY contexts (destructive op).
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        success stdout JSON shape (C3 single mutation):

        ```
        {
          removed:             boolean,    // true if entry existed and was deleted
          word:                string,     // the word arg (echoed for clarity)
          affected_card_keys:  string[]    // cards whose glossary field referenced this word
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        exit code policy: 0 on success; thrown→3 (NOT_FOUND) if the word was never defined.
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
        `word` field is mandatory per C3 (mutation must identify what it mutated). The
        sibling `glossary rename` also carries old_word/new_word; this consistency lets
        a generic glossary-mutation consumer rely on the word being in the payload.
      always_holds: per-call
  failures:
    - violation: --yes missing in a non-TTY context.
      behavior: >-
        CliUsageError → stderr `CLI_USAGE_ERROR`; exit 2.
    - violation: Word not in glossary.
      behavior: >-
        thrown → stderr `CARD_NOT_FOUND` JSON-line; exit 3. (The word-not-defined
        case reuses the not-found error class; no separate code.)
---
