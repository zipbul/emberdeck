---
key: cli-surface/command-routing-and-envelope
summary: >-
  ed binary command tree, JSON-envelope output contract, error class to
  exit-code mapping, and quiet mode behavior.
status: draft
type: brief
parent: cli-surface
glossary:
  - json-envelope
brief:
  context:
    problem: >
      Every ed subcommand returns JSON consumed by humans, scripts, CI, and the
      Claude Code skill.

      Without a single envelope shape and exit-code contract, callers must parse
      N different

      formats and infer success from stdout, breaking automation.
    impact:
      - statement: Inconsistent output shapes break shell pipelines and CI integrations.
      - statement: Inconsistent exit codes break gating logic, allowing failures to ship.
  scope:
    goals:
      - id: G-001
        statement: >-
          Every command returns the envelope {schemaVersion, status, data,
          warnings, errors} on stdout.
      - id: G-002
        statement: >-
          Every error class maps to a documented exit code (0 ok, 1 generic, 2
          validation/usage, 3 not_found, 4 conflict, 5 IO, 6 config_missing, 7
          transient, 130 SIGINT).
      - id: G-003
        statement: >-
          --quiet collapses stdout to the result data and routes diagnostics to
          stderr.
    non_goals:
      - id: NG-001
        statement: Pretty TTY output (envelope is the contract).
      - id: NG-002
        statement: Localized error messages.
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
        stdout contains a JSON envelope with status ok and data populated; exit
        0.
      covers:
        - G-001
    - id: S-H-02
      kind: happy
      given: ed card create with --quiet.
      when: The command succeeds.
      then: stdout contains only the data key; diagnostics go to stderr; exit 0.
      covers:
        - G-003
    - id: S-F-01
      kind: failure
      given: A command receives an unknown card key.
      when: The runner catches CardNotFoundError.
      then: Envelope status error and exit code 3.
      covers:
        - G-002
    - id: S-F-02
      kind: failure
      given: A command invoked with malformed input.
      when: A CliUsageError is thrown.
      then: Envelope status error and exit code 2.
      covers:
        - G-002
  design:
    overview: >
      The runner wraps each subcommand action: it constructs the runtime context
      from setup,

      catches known error classes, maps them to exit codes, and serializes the
      envelope. Output

      helpers (ok, fail) build the envelope; output writer respects --quiet.
      Command tree under

      src/cli/commands/ groups subcommands by topic (card, glossary, validate,
      check, spec, bulk).
    components:
      - name: runner
        responsibility: >-
          Build runtime context, run action, catch errors, serialize envelope,
          exit with correct code.
        interacts_with:
          - output
          - setup
      - name: output
        responsibility: Build ok/fail envelopes, respect --quiet, route diagnostics to stderr.
        interacts_with:
          - runner
      - name: command-tree
        responsibility: >-
          commander.js based command tree under src/cli/commands grouped by
          topic.
        interacts_with:
          - runner
      - name: errors-mapper
        responsibility: Map known error classes to exit codes and envelope error entries.
        interacts_with:
          - runner
    data_flow: []
    invariants:
      - id: DI-001
        statement: >-
          Every subcommand returns the same envelope shape regardless of error
          path.
      - id: DI-002
        statement: Exit codes match the documented mapping without exception.
  policy:
    - id: R-001
      subject: Every subcommand
      keyword: MUST
      predicate: >-
        emit the documented envelope on stdout with status one of ok, partial,
        error.
      governs:
        - S-H-01
        - S-H-02
    - id: R-002
      subject: Error mapping
      keyword: SHALL
      predicate: >-
        map CardNotFoundError to 3, validation/usage errors to 2, conflicts to
        4, IO to 5, config-missing to 6, transient to 7.
      governs:
        - S-F-01
        - S-F-02
    - id: R-003
      subject: '--quiet mode'
      keyword: MUST
      predicate: route diagnostics to stderr and emit only the result data on stdout.
      governs:
        - S-H-02
  external:
    - id: C-001
      statement: >-
        Envelope and exit-code contract are documented in the SKILL
        response_shapes and commands sections.
      reference:
        title: emberdeck SKILL response_shapes section
        locator: >-
          /home/revil/projects/zipbul/emberdeck/.claude/skills/emberdeck/SKILL.md
  compatibility:
    guarantees:
      - subject: Envelope schemaVersion
        version_range: 1.x
        breaks_if: Top-level keys are renamed or removed.
  limits:
    - id: KL-001
      statement: >-
        TTY-pretty output is not provided; piping to jq is the intended
        consumption pattern.
    - id: KL-002
      statement: Localization is not supported; messages are English only.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          Every command in the tree returns the envelope shape across success
          and failure paths.
        method: Snapshot test sweeping every command with valid and invalid inputs.
      verifies:
        - S-H-01
        - S-F-01
        - S-F-02
    - id: SC-002
      type: binary
      measure:
        predicate: '--quiet mode emits no diagnostics on stdout.'
        method: CLI integration test capturing stdout vs stderr.
      verifies:
        - S-H-02
  rationale:
    alternatives:
      - option: Different output shapes per command optimized for human readability.
        pros:
          - Friendlier in TTY.
        cons:
          - Breaks the automation contract that scripts depend on.
      - option: Plain-text human output with --json opt-in.
        pros:
          - Friendlier default.
        cons:
          - Most consumers (CI
          - skill) need JSON; opt-in becomes the default in practice.
    chosen:
      option: >-
        JSON-envelope as the only contract with --quiet for compact data-only
        output.
      reasoning: >-
        Matches the actual deployment (scripts, CI, skill) and removes
        ambiguity.
    addresses:
      - KL-001
      - KL-002
---
