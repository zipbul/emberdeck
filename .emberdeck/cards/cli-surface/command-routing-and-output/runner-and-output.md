---
key: cli-surface/command-routing-and-output/runner-and-output
summary: >-
  run wraps every subcommand action; emitResult writes stdout JSON of the
  command's natural shape; emitError writes stderr text + exit code; emitWarning
  streams CARD_SYNC_FAILED JSON-lines to stderr.
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        A commander.js subcommand action wraps its body in run with a CommandFn
        that returns the command's natural data (no envelope).
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the runner writes the command's returned data as JSON to
        stdout. No schemaVersion, no top-level status/errors/warnings wrapper —
        the data IS the stdout.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        On failure (thrown error or command-declared non-zero exit) the runner
        emits a single `level:error` JSON-line on stderr via toCliError
        (`{level:error, code, message, details?}`) and exits with the
        spec-declared code. stdout MUST be empty on the failure path.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-004
    - id: POST-003
      guarantee: >-
        Exit codes come from the EXIT enum (`src/cli/exit-codes.ts`) and are
        chosen per error class: CardNotFoundError → 3, CliUsageError → 2,
        ConflictError → 4, IO errors → 5, ConfigMissing → 6, transient → 7,
        SIGINT → 130, generic → 1.
      keyword: SHALL
      derives: cli-surface/command-routing-and-output#G-002
    - id: POST-004
      guarantee: >-
        Per-file sync failures returned by ensureCardsSynced are streamed to
        stderr as JSON-lines `{level:warning, code:card-sync-failed, message,
        details:{filePath}}` regardless of the command outcome. They do not
        affect stdout or exit code.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-003
    - id: POST-005
      guarantee: >-
        --quiet emits the same per-command shape but compact (single-line
        JSON.stringify, no indent) on stdout; suppresses stderr `level:warning`
        and `level:verbose` lines; `level:error` is still emitted on failure.
        quiet does NOT alter the data shape — only format and non-fatal stderr.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-005
  invariants:
    - id: INV-001
      statement: >-
        Every catchable error class is mapped through toCliError to a (code,
        message) pair with a stable exit code.
      always_holds: per-call
    - id: INV-002
      statement: >-
        run invokes the card-storage/persistence file-to-DB auto-sync
        (ensureCardsSynced, derives card-storage/persistence#G-004) after
        buildRuntime and before delegating to the CommandFn, so every command
        observes a DB consistent with the on-disk card files at command start.
      always_holds: per-call
    - id: INV-003
      statement: >-
        stdout and stderr are disjoint channels by responsibility. stdout =
        command result data (success only). stderr = diagnostics (auto-sync
        JSON-lines, error messages, verbose traces). A consumer detecting
        failure MUST use exit code, not stdout content.
      always_holds: per-call
    - id: INV-004
      statement: >-
        No command emits the v1 envelope keys (schemaVersion, status, warnings,
        errors at the top level). These are removed by design; any reappearance
        is a regression.
      always_holds: cross-call
    - id: INV-005
      statement: >-
        Every stderr line is a JSON-line of the canonical schema `{level, code,
        message, details?}`. All property names (including inside the `details`
        bag) are camelCase. Error code values are kebab-case.
      always_holds: cross-call
  failures:
    - violation: An unmapped error class is thrown inside the action.
      behavior: >-
        toCliError maps to code=`internal-error` message=stringified error;
        runner emits a single `level:error` JSON-line on stderr and exits 1.
    - violation: >-
        ensureCardsSynced itself throws (e.g. DB write failure at the schema
        layer, not a per-file parse error).
      behavior: >-
        The error propagates through the run try/catch and is mapped via
        toCliError to a stderr line + non-zero exit; the command is not invoked.
    - violation: A CommandFn returns undefined/null where data is expected.
      behavior: >-
        A CommandFn returning undefined (or `{data: undefined}`) yields no
        stdout output and exit 0. Commands that need to emit JSON `null` MUST
        return `{data: null}` explicitly. Commands MUST NOT write to stdout
        directly — only the runner calls emitResult.
    - violation: A SIGINT or SIGTERM is received during command execution.
      behavior: >-
        Best-effort cleanup runs; stderr emits a single 'SIGINT received,
        exiting' line; process exits with code 130. stdout is whatever was
        already written (potentially partial JSON) — consumers MUST check exit
        code.
---
