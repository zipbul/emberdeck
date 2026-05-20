---
key: cli-surface/command-routing-and-output/commands/validate-links
summary: >-
  Per-command CLI-shape spec for 'ed validate links'; declares per-card link
  breakdown shape (POST-001) and 0/2 exit policy (POST-002).
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

        // stdout shape for `ed validate links [key]`

        {
          summary: { total, ok, broken, skipped, ioFailed, planned },
          items: {
            key, declared, resolved,
            brokenLinks?:  { file, symbol, reason: 'gildash-unavailable' | 'symbol-not-found' }[],
            plannedLinks?: { file, symbol, reason: 'gildash-unavailable' | 'symbol-not-found' }[],
            skipped?: { reason: 'key-mismatch' },
            ioError?: { message }
          }[]
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): summary.broken === 0 and summary.ioFailed === 0.

        - 2 (EXIT.VALIDATION_FAILURE): summary.broken > 0 or summary.ioFailed >
        0.

        - thrown mapping: CardNotFoundError → card-not-found → 3 (when an
        explicit key arg points to no card); GildashInitError from the
        ensureReindexed bootstrap → gildash-init-failed → 6; other reindex / IO
        errors propagated from the op → internal-error → 1.
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
        An active card has at least one broken code link (symbol-not-found or
        gildash-unavailable).
      behavior: >-
        stdout emits the data shape with brokenLinks populated, and the process
        exits 2.
    - violation: >-
        Per-card link validation hits an I/O failure or a frontmatter-key vs
        file-slug mismatch.
      behavior: >-
        stdout reports the offending entry via items[i].ioError={message} or
        items[i].skipped={reason:'key-mismatch'}; the process exits 2 when
        summary.broken + summary.ioFailed > 0 and 0 otherwise.
    - violation: Explicit `[key]` argument supplied but no card resolves to that key.
      behavior: >-
        CardNotFoundError → stderr `{code:'card-not-found', message}` and the
        process exits 3.
---
