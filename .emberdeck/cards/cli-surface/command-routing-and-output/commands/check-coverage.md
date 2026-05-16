---
key: cli-surface/command-routing-and-output/commands/check-coverage
summary: >-
  Per-command CLI-shape spec for 'ed check coverage' (3 modes: card / uncovered
  / suggest); declares mode-specific shapes (POST-001a/b/c) and 0/3 exit policy
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
        arguments to this command's action. The mode is selected by the
        arguments: a <key> positional → 'card'; --uncovered → 'uncovered';
        --suggest → 'suggest'.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001a
      guarantee: >-
        mode='card' (`ed check coverage <key>`): on success the `data` matches
        the shape:

        ```jsonc

        // getLinkCoverage produces this link-coverage shape per card.

        // unreferencedSymbols is the full array (no CLI-side slice); callers
        can page with jq if needed.

        // A card with zero declared links surfaces coverageRatio = 1 (vacuous
        coverage).

        { key, declared, resolved, broken, coverageRatio: number,
          unreferencedSymbols: { file, symbol, kind }[],    // full array
          unreferencedTotal: number }                        // === unreferencedSymbols.length
        ```

        A future migration from link-coverage to symbol-coverage is tracked
        separately; this card documents only the shape above.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-001b
      guarantee: >-
        mode='uncovered' (`ed check coverage --uncovered`): on success the
        `data` matches the shape:

        ```jsonc

        // uncovered is the full array (no CLI-side slice).

        { totalSymbols, coveredSymbols, coverageRatio: number | null,
          uncovered: { file, symbol, kind }[],    // full array
          uncoveredTotal: number }                 // === uncovered.length
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-001c
      guarantee: >-
        mode='suggest' (`ed check coverage --suggest`): on success the `data`
        matches the shape:

        ```jsonc

        {
          suggestions: {
            key,                                           // the op's suggestedKey
            type: 'domain' | 'brief' | 'spec',
            parent?: string,
            files: string[],                               // arrays returned verbatim by the op (no count conversion)
            symbols: { file, symbol, kind }[],             // arrays returned verbatim by the op
            reason: string,
            suggestedGlossary?: string[]
          }[],
          total
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): every mode succeeds (a coverage result, possibly with
        empty arrays, is emitted).

        - thrown mapping (mode='card' only): CardNotFoundError → 3
        (EXIT.NOT_FOUND). Modes 'uncovered' and 'suggest' have no thrown
        mapping.
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
    - violation: mode='card' is selected and no card exists for the requested key.
      behavior: >-
        stderr emits `{level:'error', code:'card-not-found', message}` and the
        process exits 3.
---
