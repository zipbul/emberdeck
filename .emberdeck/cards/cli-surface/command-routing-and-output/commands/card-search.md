---
key: cli-surface/command-routing-and-output/commands/card-search
summary: >-
  Per-command CLI-shape spec for 'ed card search'; declares FTS5 items with
  snippet/rank shape (POST-001) and 0/2 exit policy (POST-002).
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

        // stdout shape for `ed card search <query>`

        // searchCards runs the indexed text-search over card body content;
        every match carries snippet and rank.

        {
          items: {
            ...CardSummary,           // key, summary, type, status, parent
            snippet: string,           // short excerpt around the match
            rank: number               // relevance score (lower is stronger)
          }[],
          total
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): the search query parsed and ran successfully (an empty
        result set is still success).

        - thrown mapping: FtsSyntaxError → 2 (EXIT.VALIDATION_FAILURE).
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
    - violation: Query violates the search-index syntax (e.g. an unmatched quote).
      behavior: >-
        stderr emits `{level:'error', code:'fts-syntax-error', message}` and the
        process exits 2.
---
