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
              count: number,
              samples: string[][]
            }
          },
          coverage: { totalSymbols, coveredSymbols, coverageRatio: number|null },
          drifted: {
            cards: { key, summary, status, driftType?, brokenLinks, totalLinks }[],
            total,
            limit: number,
            offset: number,
            hasMore: boolean
          },
          glossary: { unusedWords: string[], entries: { word, definition }[] },
          unlinkedSymbols: { file, symbol, kind }[]
        }

        ```

        Note: codeCycles.count is observed cycle count capped at op-layer
        MAX_CYCLES_FETCH (200) — `count === 200` reads as 'at least 200'.
        unlinkedSymbols capped at UNLINKED_SYMBOLS_LIMIT (currently 20).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): analyze report is returned on the read-only happy path.

        - thrown mapping: ensureReindexed (called by the op before the
        symbol-coverage queries at src/ops/analyze.ts:155) can throw on
        code-index failure — these errors propagate up through the runner and
        map via toCliError (GildashInitError → gildash-init-failed → 6;
        otherwise → internal-error → 1).
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
        commander rejects upstream taking the runner-commander-fallback path:
        stderr `{level:'error', code:'cli-usage-error', ...}` and exit 2.
    - violation: ensureReindexed fails to initialize or refresh the code index.
      behavior: >-
        The op throws (GildashInitError or downstream class); toCliError maps
        the class to a kebab code and the runner emits a single stderr
        level:error line and exits (6 for gildash-init-failed, 1 for
        internal-error).
---
