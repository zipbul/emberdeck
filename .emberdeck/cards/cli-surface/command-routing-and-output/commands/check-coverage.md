---
key: cli-surface/command-routing-and-output/commands/check-coverage
summary: >-
  Per-command CLI-shape spec for ed check coverage (3 modes: card / uncovered /
  suggest); declares mode-specific shapes (POST-001a/b/c) and 0/2 exit policy
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
    - id: POST-001a
      guarantee: >-
        Mode `card` (`ed check coverage <key>`): `data` is

        ```jsonc

        {
          key: string,
          declared: number,
          resolved: number,
          broken: number,
          coverageRatio: number,
          unreferencedSymbols: { file, symbol, kind }[],
          unreferencedTotal: number
        }

        ```

        Note: getLinkCoverage does NOT check card existence — a non-existent key
        resolves to zero declared/resolved/broken with empty unreferencedSymbols
        (no CardNotFoundError thrown in mode=card).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-001b
      guarantee: |-
        Mode `uncovered` (`ed check coverage --uncovered`): `data` is
        ```jsonc
        {
          totalSymbols: number,
          coveredSymbols: number,
          coverageRatio: number | null,   // null when no symbols are indexed; otherwise covered/total
          uncovered: { file, symbol, kind }[],
          uncoveredTotal: number
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-001c
      guarantee: |-
        Mode `suggest` (`ed check coverage --suggest`): `data` is
        ```jsonc
        {
          suggestions: {
            key: string,
            type: 'domain'|'brief'|'spec',
            parent?: string,
            files: string[],
            symbols: { file: string, symbol: string, kind: string }[],   // nested per-symbol shape (NOT a flat string array)
            reason: string,
            suggestedGlossary?: string[]
          }[],
          total: number
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): the requested mode's data shape is returned (read-only).

        - thrown mapping: CliUsageError → cli-usage-error → 2 when no key is
        supplied AND no mode flag is supplied. mode=card does NOT throw
        CardNotFoundError — missing key resolves to zero-link coverage.
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
    - violation: No positional key and no mode flag (--uncovered/--suggest) supplied.
      behavior: >-
        CliUsageError → stderr `{code:'cli-usage-error', message}` and the
        process exits 2.
      id: FAIL-001
      case_of: cli-surface/command-routing-and-output#S-F-02
---
