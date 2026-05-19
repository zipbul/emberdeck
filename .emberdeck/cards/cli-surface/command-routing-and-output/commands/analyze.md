---
key: cli-surface/command-routing-and-output/commands/analyze
summary: >-
  Per-command CLI-shape spec for 'ed analyze'; declares
  health/coverage/drifted/glossary/unlinkedSymbols composite shape (POST-001)
  and exit 0 policy (POST-002).
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

        // stdout shape for `ed analyze [--drifted-limit N] [--drifted-offset
        N]`

        {
          health: {
            total, active, drifted, draft, brokenLinks,
            codeStats?: { files: number, symbols: number },
            codeCycles?: {
              count: number,                  // observed cycle count, capped at the op-layer MAX_CYCLES_FETCH (200). When the cap is hit the true total is unknown to this call; `count === 200` should be read as "≥200".
              samples: string[][]             // up to op-layer MAX_CYCLE_SAMPLES.
            }
          },
          coverage: { totalSymbols, coveredSymbols, coverageRatio: number|null },
          drifted: {
            cards: { key, summary, driftType?, brokenLinks, totalLinks }[],
            total,
            limit: number,
            offset: number,
            hasMore: boolean
          },
          glossary: { unusedWords: string[], entries: { word, definition }[] },
          unlinkedSymbols: { file, symbol, kind }[]   // capped at op-layer UNLINKED_SYMBOLS_LIMIT (currently 20)
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): analyze report is always returned (read-only with respect
        to cards; the retention-prune side effect on the code-index changelog is
        hygiene and does not affect exit code).

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
    - violation: '--drifted-limit or --drifted-offset is negative.'
      behavior: >-
        commander rejects the invocation upstream, taking the
        runner-commander-fallback path: stderr `{level:'error',
        code:'cli-usage-error', ...}` and exit 2.
---
