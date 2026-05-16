---
key: cli-surface/command-routing-and-output/commands/card-tree
summary: >-
  Per-command CLI-shape spec for 'ed card tree'; declares root TreeNode shape
  (POST-001) and 0/3 exit policy (POST-002).
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
        `data` is the root TreeNode directly (no enclosing object):

        ```jsonc

        // stdout shape for `ed card tree <key> [--depth N]`

        TreeNode

        // TreeNode = { key, type, status, summary, depth: number, truncated?:
        boolean, children: TreeNode[] }

        // --depth defaults to 10 and is capped at 20; nodes that have unvisited
        children at the ceiling set truncated=true.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): tree walk succeeded (nodes reaching maxDepth carry
        truncated=true).

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
    - violation: No card exists for the requested root key.
      behavior: >-
        stderr emits `{level:'error', code:'card-not-found', message}` and the
        process exits 3.
---
