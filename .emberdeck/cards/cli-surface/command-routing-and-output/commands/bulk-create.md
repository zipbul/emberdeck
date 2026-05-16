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
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` matches the shape:

        ```jsonc

        // stdout shape for `ed bulk create --from FILE`

        {
          created: { inputIndex, key, filePath }[],
          failed:  { inputIndex, key?, error }[],
          partialKeys: string[],   // keys that succeeded in phase 1 (the card row was created) but whose phase-2 relations update failed; the card exists without its intended relations.
          total: number            // total input entry count
        }

        // Entries are processed independently after a topological sort: a
        failure on entry N does not roll back entries 1..N-1.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0 (every entry persisted; partialKeys
        may still be non-empty when a phase-2 relations update failed, but the
        partial state is signalled in the data, not the exit code).

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0 (data is still emitted,
        only the exit code differs — the CI gate signal).

        - thrown mapping: none for per-item failures (they accumulate in
        failed[], no throw). Build or IO errors fall through to the parent
        runner's generic mapping.
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
    - violation: >-
        Phase-1 succeeded but the phase-2 relations update failed for some
        entries.
      behavior: >-
        Each such key is appended to partialKeys[]; stdout emits the data shape
        normally; exit code is 0 unless failed[] is also non-empty. The operator
        can rerun `ed card update KEY --field relations=...` to repair.
---
