---
key: cli-surface/command-routing-and-output/commands/spec-sync
summary: >-
  Per-command CLI-shape spec for 'ed spec sync'; declares alreadyLinked +
  linkMissing/unmatched/markerMissing diagnostics shape (POST-001) and exit 0
  policy (POST-002).
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

        // stdout shape for `ed spec sync`

        {
          alreadyLinked: number,                                    // annotations that matched an existing binding row and were skipped
          linkMissing:   { cardKey, file, symbol }[],               // newly inserted binding rows
          unmatched:     { cardKey, file, symbol }[],               // annotations whose card key does not exist
          markerMissing: { cardKey, file, symbol }[]                // binding rows whose source `@spec` annotation is no longer present
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): sync is fact-recording; unmatched and markerMissing are
        diagnostics, not failures.

        - thrown mapping: syncSpecAnnotations awaits ensureReindexed(ctx) before
        its main logic; if the code-index reindex itself fails (e.g.
        GildashInitError → gildash-init-failed → 6), the throw propagates up
        through this op (not the runner setup step). Op-level indexed-cache or
        IO failures inside the reconciliation loop fall through to the
        toCliError default branch → `internal-error` exit 1.
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
        Code-index dependency initialization fails (projectRoot missing, no
        indexable source, or backing-index open error). ensureReindexed throws
        inside syncSpecAnnotations.
      behavior: >-
        GildashInitError → stderr `{level:error, code:gildash-init-failed,
        message}` and the process exits 6 (EXIT.CONFIG_MISSING). The throw
        originates inside the op (after the runner has built the runtime), not
        at buildRuntime.
    - violation: Op-level indexed-cache write or IO failure.
      behavior: >-
        stderr emits `{level:'error', code:'internal-error', message,
        details:{class}}` and the process exits 1 (the toCliError default
        branch). A dedicated IO error class would let this map to exit 5 in the
        future.
---
