---
key: cli-surface/command-routing-and-output/commands/card-context
summary: >-
  Per-command CLI-shape spec for 'ed card context'; declares flat frontmatter +
  upstream/downstream/parentChain/codeLinks shape (POST-001) and 0/3 exit policy
  (POST-002).
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

        // stdout shape for `ed card context <key> [--depth N]`

        {
          key,
          // core frontmatter fields (same flat layout as `ed card get`):
          summary, status, type, parent: string|null,
          glossary: string[], relations?: string[], tags?: string[],
          principle?, domain?, brief?, spec?,
          upstream:   CardSummary[],
          downstream: CardSummary[],
          parentChain: CardSummary[],           // root → directly-above the requested card
          related?: { card: CardSummary, depth: number, direction: 'forward'|'backward' }[],   // populated when depth > 1 (BFS over the relation graph)
          truncated?: boolean,
          codeLinks: { resolved: number, total: number }
        }

        // CLI --depth defaults to 1 at both the ops and CLI layers.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): context lookup succeeded.
        - thrown mapping: CardNotFoundError → 3 (EXIT.NOT_FOUND).
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
    - violation: No card exists for the requested key.
      behavior: >-
        stderr emits `{level:'error', code:'card-not-found', message}` and the
        process exits 3.
---
