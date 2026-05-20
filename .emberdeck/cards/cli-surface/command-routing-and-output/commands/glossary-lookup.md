---
key: cli-surface/command-routing-and-output/commands/glossary-lookup
summary: >-
  Per-command CLI-shape spec for 'ed glossary lookup'; declares entries[] +
  total shape (POST-001) and exit 0 policy (POST-002).
status: active
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Runner has built a CliRuntime and forwarded commander-validated
        arguments to this command's action.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` matches the shape:

        ```jsonc

        // stdout shape for `ed glossary lookup [WORD]`

        // WITH a WORD argument (single-lookup mode):

        //   { found: boolean, entry?: { word, definition } }   // { found:
        false } when absent; never an empty list

        // WITHOUT an argument (list mode): every entry is returned:

        //   { entries: { word, definition }[], total: number }   // total ===
        entries.length

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): lookup always succeeds. With a WORD: an unknown word
        produces `{ found: false }` (a present word produces `{ found: true,
        entry }`). Without a WORD (list mode): an empty store produces `{
        entries: [], total: 0 }`.

        - thrown mapping: none.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        Inherits INV-001..INV-005 from parent spec runner-and-output (canonical
        stderr JSON-line schema, disjoint stdout/stderr channels, no envelope,
        --quiet semantics, empty stdout on failure).
      always_holds: per-call
  failures:
    - violation: More than one word positional was passed (commander rejects upstream).
      behavior: >-
        Falls through the runner-commander-fallback path: stderr emits
        `{level:'error', code:'cli-usage-error', ...}` and the process exits 2.
---
