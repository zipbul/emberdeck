---
key: cli-surface/command-routing-and-output
summary: >-
  ed binary command tree, per-command output shape contract, error class to
  exit-code mapping, and quiet/stderr behavior.
status: active
type: brief
parent: cli-surface
glossary:
  - json-envelope
brief:
  context:
    problem: >-
      Every ed subcommand returns data consumed by humans, scripts, CI, and the
      Claude Code skill. Earlier iterations forced every command into a uniform
      JSON envelope `{schemaVersion, status, data, warnings, errors, error?}` so
      consumers could parse one shape. In practice the envelope mixed three
      distinct concerns inside `errors[]` (per-link broken / structural skip /
      transient I/O), forced `data` to be polymorphic per command anyway, and
      tied exit-code semantics to derivation rules that drifted between
      commands. After multiple review rounds the design pivots: each command
      emits the JSON shape natural to its result; failures use stderr + exit
      code; auto-sync warnings stream to stderr as JSON-lines. The envelope is
      removed.
    impact:
      - statement: >-
          Mixed `errors[]` semantics caused recurring review-defect cycles in
          validate-family commands; per-command shapes eliminate the mixing
          surface.
      - statement: >-
          Exit codes were derived from envelope status in ways that diverged
          between commands; explicit per-command exit-code policy in spec cards
          makes CI gating predictable.
      - statement: >-
          Auto-sync diagnostics on stdout polluted the data channel; routing
          them to stderr keeps stdout JSON pipe-clean.
  scope:
    goals:
      - id: G-001
        statement: >-
          Each command's stdout (on success) is JSON shaped for that command's
          result. No shared envelope wrapper, no schemaVersion field, no forced
          `data`/`errors`/`warnings` top-level keys.
      - id: G-002
        statement: >-
          Each command maps its observable outcomes to documented exit codes
          (0=ok, 2=validation/usage, 3=not_found, 4=conflict, 5=permission/IO,
          6=config_missing, 7=transient, 1=generic, 130=SIGINT). The exit-code
          policy per command is declared in its spec card.
      - id: G-003
        statement: >-
          Cross-cutting diagnostics — auto-sync per-file failures, verbose
          tracing, command errors — go to stderr as a single canonical JSON-line
          schema `{level, code, message, details?}`. No free-form text on
          stderr. Auto-sync failures use level:`warning` with
          code:`card-sync-failed`; thrown command errors use level:`error`;
          verbose traces use level:`verbose`.
      - id: G-004
        statement: >-
          On command failure (typo, IO, crash) stdout emits no JSON; stderr
          emits exactly one `level:error` JSON-line + exit code is non-zero.
          Consumers detect failure by exit code, not by parsing stdout.
      - id: G-005
        statement: >-
          --quiet emits the same per-command JSON shape but compact (single-line
          JSON.stringify, no indent) on stdout; suppresses stderr
          `level:warning` and `level:verbose` lines; `level:error` is still
          emitted on failure. --quiet does NOT alter the data shape — only
          format and non-fatal stderr.
    non_goals:
      - id: NG-001
        statement: Pretty TTY output (stdout JSON or empty).
      - id: NG-002
        statement: Localized error messages.
      - id: NG-003
        statement: >-
          Backward compatibility with the v1 envelope. The redesign is a
          breaking change.
    assumptions:
      - id: A-001
        statement: All commands share the runner abstraction in src/cli/runner.ts.
        verification: Grep for run( use across commands.
        reevaluate_when: A new command implements its own runner.
  flow:
    - id: S-H-01
      kind: happy
      given: ed analyze invocation in normal mode.
      when: The runner completes successfully.
      then: >-
        stdout contains the analyze-specific JSON (health / coverage / drift /
        glossary fields at the top level, no envelope wrapper); stderr empty;
        exit 0.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: ed card create with --quiet.
      when: The command succeeds.
      then: >-
        stdout contains only the created card key string (or a minimal JSON
        payload); stderr empty; exit 0.
      covers:
        - G-005
    - id: S-H-03
      kind: happy
      given: >-
        An external editor wrote a malformed card file; user runs `ed card
        list`.
      when: Auto-sync at runner entry hits the malformed file.
      then: >-
        stderr contains a single card-sync-failed JSON-line for that file;
        stdout contains the normal card list (excluding the unsynced card); exit
        0.
      covers:
        - G-003
    - id: S-F-01
      kind: failure
      given: A command receives an unknown card key.
      when: The runner catches CardNotFoundError.
      then: 'stdout is empty; stderr contains ''Card not found: <key>''; exit 3.'
      covers:
        - G-002
        - G-004
    - id: S-F-02
      kind: failure
      given: A command invoked with malformed input.
      when: A CliUsageError is thrown.
      then: stdout is empty; stderr contains the usage error message; exit 2.
      covers:
        - G-002
        - G-004
  design:
    overview: >-
      The runner builds the runtime context, runs auto-sync, invokes the command
      action, and dispatches output: success → stdout JSON of the command's
      natural shape; failure → stderr text + exit code. Auto-sync per-file
      failures stream to stderr as JSON-lines independent of the command
      outcome. Output helpers expose `emitResult(data)` for stdout and
      `emitWarning(obj)` / `emitError(message, code)` for stderr. Each command's
      spec card declares its stdout shape and the set of exit codes it can
      produce.
    components:
      - name: runner
        responsibility: >-
          Build runtime context, run auto-sync, invoke action, route
          success/failure to stdout/stderr, exit with command-declared code.
        interacts_with:
          - output
          - setup
          - ensureCardsSynced
      - name: output
        responsibility: >-
          emitResult writes JSON to stdout. emitError writes a line to stderr.
          emitWarning writes a JSON-line to stderr. No envelope helpers.
        interacts_with:
          - runner
      - name: command-tree
        responsibility: >-
          commander.js based command tree under src/cli/commands grouped by
          topic. Each command returns its natural data; runner emits it.
        interacts_with:
          - runner
      - name: errors-mapper
        responsibility: Map known error classes to exit codes and stderr messages.
        interacts_with:
          - runner
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          On success: stdout is valid JSON of the command's spec-declared shape;
          stderr may contain auto-sync JSON-lines but no fatal text.
      - id: DI-002
        statement: >-
          On failure: stdout is empty (no JSON written); stderr contains exactly
          one final error line; exit code is non-zero per the error class map.
      - id: DI-003
        statement: >-
          Exit codes are taken from the EXIT enum and match the error class →
          code map. Each command's spec card lists which codes it can produce;
          the runner never invents codes.
      - id: DI-004
        statement: >-
          Auto-sync warnings stream to stderr as JSON-lines (one
          card-sync-failed object per line) regardless of the command's outcome.
          They do not influence exit code.
  policy:
    - id: R-001
      subject: Every subcommand on success
      keyword: MUST
      predicate: >-
        emit JSON on stdout matching the shape declared in its spec card (no
        envelope wrapper).
      governs:
        - S-H-01
        - S-H-02
        - S-H-03
    - id: R-002
      subject: Error mapping
      keyword: SHALL
      predicate: >-
        map CardNotFoundError to exit 3, validation/usage errors to 2, conflicts
        to 4, IO to 5, config-missing to 6, transient to 7, generic to 1, SIGINT
        to 130.
      governs:
        - S-F-01
        - S-F-02
    - id: R-003
      subject: Every subcommand on failure
      keyword: MUST
      predicate: >-
        write the error message to stderr only; stdout MUST NOT contain JSON or
        any other output on the failure path.
      governs:
        - S-F-01
        - S-F-02
    - id: R-004
      subject: Auto-sync warnings
      keyword: MUST
      predicate: >-
        emit one `level:warning code:card-sync-failed` JSON-line per failed file
        on stderr, never on stdout, regardless of the command outcome.
      governs:
        - S-H-03
    - id: R-005
      subject: Every command spec card
      keyword: MUST
      predicate: >-
        declare its stdout JSON shape and the closed set of exit codes it can
        return.
      governs:
        - S-H-01
        - S-H-02
  external:
    - id: C-001
      statement: >-
        Per-command output shapes and exit-code policies are documented in the
        SKILL `<commands>` and per-command response sections; the SKILL is the
        agent-facing index of the individual spec cards.
      reference:
        title: emberdeck SKILL.md
        locator: >-
          /home/revil/projects/zipbul/emberdeck/.claude/skills/emberdeck/SKILL.md
  compatibility:
    guarantees:
      - subject: Per-command stdout shape
        version_range: post-envelope (no version field; spec card is the contract)
        breaks_if: >-
          A command's spec-declared shape changes; consumers must read the spec
          card for the contract.
    migration_path: >-
      v1 envelope consumers cannot read v2 stdout without rewriting. Migration
      is a single breaking step; no dual emission is supported.
  limits:
    - id: KL-001
      statement: No pretty TTY output; piping to jq is the intended consumption pattern.
    - id: KL-002
      statement: Localization is not supported; messages are English only.
    - id: KL-003
      statement: >-
        Per-command shapes diverge by design; no generic 'parse any ed output'
        tool is possible. Consumers per command.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          Every command emits stdout JSON matching the shape declared in its
          spec card on success, and no stdout output on failure.
        method: >-
          Per-command snapshot tests of stdout/stderr/exit-code triples across
          success and failure inputs.
      verifies:
        - S-H-01
        - S-F-01
        - S-F-02
    - id: SC-002
      type: binary
      measure:
        predicate: >-
          --quiet emits only the core payload on stdout and silences non-fatal
          stderr.
        method: CLI integration test capturing stdout vs stderr under --quiet.
        reference: test/cli/
      verifies:
        - S-H-02
    - id: SC-003
      type: binary
      measure:
        predicate: >-
          Auto-sync per-file failures stream as JSON-lines on stderr in the
          presence of malformed card files.
        method: >-
          fs-race test injecting a malformed card and asserting stderr line
          shape.
      verifies:
        - S-H-03
  rationale:
    alternatives:
      - option: Uniform JSON envelope on every command (v1 design).
        pros:
          - One parser handles every command.
          - Single SKILL section documents the wrapper.
        cons:
          - >-
            `errors[]` mixed three distinct concerns (per-link / structural /
            I/O), surfacing as repeated review defects.
          - >-
            `data` was already polymorphic per command — the wrapper added
            ceremony without uniformity.
          - Exit code derivation rules diverged between commands.
      - option: >-
          Envelope variant with `kind: list | report | mutation` discriminator
          (v2 redesign attempt).
        pros:
          - Preserves a shared header for generic consumers.
        cons:
          - >-
            Hostile review surfaced ~18 unspecified invariants (outcome
            derivation, crash contract, args provenance, shape skeleton per
            kind).
          - Phased migration required dual-emission; no clean sunset.
      - option: Per-command natural shapes with stderr for cross-cutting (chosen).
        pros:
          - Each command's shape matches its semantics with no procrustean fit.
          - Eliminates the mixed-errors defect class entirely.
          - stderr/stdout split is standard UNIX, well understood by tooling.
        cons:
          - Breaking change for v1 consumers.
          - No generic parser; consumers must know each command's shape.
          - >-
            stderr JSON-lines format needs documenting (mitigated by R-004 +
            SKILL doc).
    chosen:
      option: Per-command natural shapes with stderr for cross-cutting diagnostics.
      reasoning: >-
        Eliminates the recurring review-defect surface that the envelope
        created. Accepts the breaking-change cost in exchange for a design that
        won't produce the same defect class on future review rounds.
    addresses:
      - KL-001
      - KL-002
      - KL-003
---
