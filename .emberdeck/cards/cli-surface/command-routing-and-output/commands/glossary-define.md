---
key: cli-surface/command-routing-and-output/commands/glossary-define
summary: >-
  ed glossary define emits {defined:[{word,definition}], failed:[{input_index,reason}], total}
  per C4; CLI input-parsing accumulates failures (was throw-first) while the op stays
  all-or-nothing.
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Inputs come from positional `WORD=DEFINITION` args and/or `--from FILE` JSON array
        of {word, definition} objects.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        success stdout JSON shape (C4 batch-mutation):

        ```
        {
          defined: { word: string, definition: string }[],   // successfully written entries
          failed:  { input_index: number, reason: string }[],
          total:   number                                    // input count
        }
        ```

        `defined` unions created-and-updated entries (an "action" discriminator is not in the
        CLI shape — the op records both as success at the glossary level). `failed` carries
        per-input parse/validation failures with their original position.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        exit code policy: 0 if failed.length === 0; 2 (VALIDATION_FAILURE) otherwise.
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
        Semantics shift relative to v1: per-input parse errors (bad pair format, missing
        word/definition in JSON entry) no longer throw at first occurrence. The CLI helpers
        `parseDefinitionPair`/`loadEntriesFromFile` accumulate per-entry failures; the op
        `defineGlossary` is called only with the surviving valid entries and retains its
        existing all-or-nothing behavior. If the op itself throws (e.g. duplicate WITHIN
        the batch surviving entries), that's a thrown error path → exit 2 with stderr error.
      always_holds: cross-call
  failures:
    - violation: A positional arg lacks `=` or has empty word.
      behavior: >-
        Entry pushed to failed[] with reason describing the parse problem;
        exit 2 if any failed.
    - violation: defineGlossary op throws on the surviving batch (e.g. validation failure inside the op).
      behavior: >-
        stderr `GLOSSARY_VALIDATION_ERROR` JSON-line; exit 2. stdout empty (no
        partial JSON; the op is all-or-nothing once called).
---
