---
key: cli-surface/command-routing-and-output/commands/bulk-create
summary: >-
  Per-command CLI-shape spec for 'ed bulk create --from FILE'; declares
  created[] + failed[] + total shape (POST-001) and 0/2 exit policy (POST-002).
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
    - id: PRE-002
      condition: >-
        `--from FILE` resolves to a readable JSON file whose root is a non-empty
        array of card-create entries.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` matches the shape:

        ```jsonc

        // stdout shape for `ed bulk create --from FILE`

        {
          created: { inputIndex, key, filePath }[],
          failed:  { inputIndex, key?, error }[],   // includes per-item validation failures AND phase-2 relation failures
          partialKeys: string[],                     // keys whose card-row was created in phase 1 but whose phase-2 relations update failed; each such key ALSO appears in failed[]
          total: number
        }

        // Entries are processed independently after a topological sort: a
        failure on entry N does not roll back entries 1..N-1.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0 (every entry persisted in both
        phases; partialKeys is empty).

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0 (per-item or phase-2
        relations failure; data is still emitted).

        - 2 (EXIT.VALIDATION_FAILURE): CliUsageError thrown when `--from` input
        is missing, not an array, or an empty array.

        - thrown mapping: CliUsageError → cli-usage-error → exit 2 (pre-op
        validation). Per-item failures do not throw — they accumulate in
        failed[].
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
        Per-item failure (duplicate key, missing parent, schema validation
        failure).
      behavior: >-
        The offending entry accumulates in failed[]; stdout still emits the data
        shape; the process exits 2 whenever failed.length > 0.
      id: FAIL-001
    - violation: >-
        Phase-1 succeeded (card row created) but the phase-2 relations update
        failed for some entries.
      behavior: >-
        Each such key appears in BOTH partialKeys[] (signalling 'card exists
        without intended relations') AND failed[] (signalling 'phase-2
        failure'); stdout emits the data shape; exit code is 2.
      id: FAIL-002
    - violation: '`--from` input is missing, not an array, or an empty array.'
      behavior: >-
        CliUsageError thrown → stderr emits `level:error code:cli-usage-error`;
        stdout empty; exit 2.
      id: FAIL-003
      case_of: cli-surface/command-routing-and-output#S-F-02
---
