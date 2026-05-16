---
key: cli-surface/command-routing-and-output/commands/check-impact
summary: >-
  Per-command CLI-shape spec for 'ed check impact'; declares affectedCards +
  risk + dependency shape (POST-001) and exit 0 policy (POST-002).
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

        // stdout shape for `ed check impact <files...> [--symbol N...]`

        {
          riskLevel: 'low' | 'medium' | 'high' | 'critical',
          affectedCards: {
            key, summary,
            linkType: 'direct' | 'transitive',
            affectedLinks: number,
            via?: string,                                    // populated for transitive entries: the direct card that linked the change in
            linkStatus?: { valid: number, broken: number }   // populated for direct entries only; transitive entries leave linkStatus undefined
          }[],
          newUncoveredFiles: string[],
          suggestedActions: string[],
          maxFanIn?: number,                                 // present when the code-index reports fan-in
          maxFanOut?: number,                                // present when the code-index reports fan-out
          directDependents?: string[]                        // direct importers of the input files
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): the impact report is always returned (read-only; a high
        riskLevel is not a failure).

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
    - violation: Zero file positionals were passed (commander rejects upstream).
      behavior: >-
        Falls through the runner-commander-fallback path: stderr emits
        `{level:'error', code:'cli-usage-error', ...}` and the process exits 2.
---
