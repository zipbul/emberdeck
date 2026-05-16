---
key: cli-surface/command-routing-and-output/commands/check-interactions
summary: >-
  Per-command CLI-shape spec for 'ed check interactions'; declares per-pair
  sharedSymbols/files + relations shape (POST-001) and exit 0 policy (POST-002).
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

        // stdout shape for `ed check interactions <keys...>`

        {
          interactions: {
            pair: [string, string],
            sharedSymbols: { file, symbol }[],
            sharedFiles: string[],
            importDependencies: { from, to, file }[],
            hasRelation: boolean,
            potentialConflicts: string[]
          }[],
          undefinedRelations: { pair: [string, string], suggestion: string }[]
          // The op does not synthesize a per-pair reason; consumers infer rationale from the populated arrays.
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): the interactions report is always returned (read-only).
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
    - violation: Fewer than two card keys passed (commander rejects upstream).
      behavior: >-
        Falls through the runner-commander-fallback path: stderr emits
        `{level:'error', code:'cli-usage-error', ...}` and the process exits 2.
---
