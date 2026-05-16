---
key: cli-surface/command-routing-and-output/commands/validate-cards
summary: >-
  Per-command CLI-shape spec for 'ed validate cards'; declares summary +
  items[].issues[] + fileLevelIssues[] shape (POST-001) and 0/2 exit policy
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

        // stdout shape for `ed validate cards`

        {
          summary: { total: number, byCode: Record<string, number> },   // keys are kebab error-code values
          // summary.byCode aggregates items[].issues plus fileLevelIssues
          // summary.total === sum(items[i].issues.length) + fileLevelIssues.length
          items: {
            key,
            filePath?,
            issues: {
              code: 'orphan-card'
                  | 'broken-parent'
                  | 'type-hierarchy-violation'
                  | 'broken-cross-domain-dep'
                  | 'broken-relation'
                  | 'rework-dependency'
                  | 'empty-tree'
                  | 'content-mismatch'
                  | 'glossary-broken'
                  | 'glossary-unused'
                  | 'broken-chain',
              message: string,
              details?: Record<string, unknown>   // keys inside details are camelCase
            }[]
          }[],
          fileLevelIssues: {
            code: 'orphan-file'
                | 'stale-db-row'
                | 'key-mismatch',
            message: string,
            filePath: string,
            key?: string
          }[]
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): summary.total === 0 (every card consistent).

        - 2 (EXIT.VALIDATION_FAILURE): summary.total > 0 (≥1 violation; data is
        still emitted, only the exit code differs).

        - thrown mapping: none (read-only); build or IO errors fall through to
        the parent runner's generic mapping.
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
    - violation: >-
        ≥1 consistency violation found (items[].issues or fileLevelIssues
        non-empty).
      behavior: >-
        stdout emits the data shape normally and exits 2; stderr is empty
        because the data channel itself reports the diagnostics.
---
