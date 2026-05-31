---
key: cli-surface/command-routing-and-output/runner-and-output
summary: >-
  run wraps every subcommand action; emitResult writes stdout JSON of the
  command's natural shape; emitError writes stderr text + exit code; emitWarning
  streams card-sync-failed JSON-lines to stderr.
status: active
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        A CLI subcommand action wraps its body in run with a CommandFn that
        returns a `{ data, exitCode? }` result; the runner writes `data` (the
        command's natural JSON shape, with no wrapper envelope) to stdout and
        applies exitCode.
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
        On a thrown failure path (the action raised an uncaught error) the
        runner emits a single `level:error` JSON-line on stderr via toCliError
        (`{level:error, code, message, details?}`) and exits with the
        spec-declared code. stdout MUST be empty on the thrown failure path.
        NOTE: per-item validation failures (e.g. bulk-create one item rejected)
        are NOT thrown — actions return `{ data, exitCode: 2 }` and stdout still
        emits the data shape with `failed[]`/`failedReferenceUpdates[]`/etc.
        populated. The CI gate signal is the non-zero exit code; consumers MUST
        use exit code, not stdout content, to detect failure.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-004
    - id: POST-003
      guarantee: >-
        Exit codes are chosen per kebab error code via a fixed code-to-exit
        mapping: `card-not-found` → 3; `card-already-exists` and
        `rename-same-path` → 4; `invalid-card-key`, `validation-error`,
        `parent-validation-error`, `fts-syntax-error`,
        `activation-guard-failed`, `cli-usage-error`, `config-parse-error`,
        `config-validation-error`, `glossary-parse-error`,
        `glossary-validation-error` → 2; `glossary-not-found` → 3;
        `gildash-init-failed` and `config-missing-file` → 6;
        `stdout-write-failed` → 5; `compensation-failed`, `internal-error`,
        `output-encode-failed` → 1; SIGINT → 130. Unknown codes fall through to
        1 (generic).
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
        EXCEPTION: warnings carrying `code:cleanup-failed` BYPASS quiet
        suppression (safety override — a failed teardown can leave artifacts
        such as an open DB file or stale lock and MUST be visible to the
        operator).
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
        run invokes the card-storage/persistence file-to-cache auto-sync
        (ensureCardsSynced, derives card-storage/persistence#G-004) after
        buildRuntime and before delegating to the CommandFn, so every command
        observes an indexed cache consistent with the on-disk card files at
        command start.
      always_holds: per-call
    - id: INV-003
      statement: >-
        stdout and stderr are disjoint channels by responsibility. stdout =
        command result data on the non-thrown result path (success OR a
        partial-result exit that still carries data). stderr = diagnostics
        (auto-sync JSON-lines, error messages, verbose traces). A consumer
        detecting a THROWN failure MUST use the exit code (thrown failures emit
        no stdout); partial results are signalled by data in stdout plus a
        non-zero exit.
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
      id: FAIL-001
    - violation: >-
        ensureCardsSynced itself throws (e.g. DB write failure at the schema
        layer, not a per-file parse error).
      behavior: >-
        The error propagates through the run try/catch and is mapped via
        toCliError to a stderr line + non-zero exit; the command is not invoked.
      id: FAIL-002
    - violation: A CommandFn returns undefined/null where data is expected.
      behavior: >-
        A CommandFn returning undefined (or `{data: undefined}`) yields no
        stdout output and exit 0. Commands that need to emit JSON `null` MUST
        return `{data: null}` explicitly. Commands MUST NOT write to stdout
        directly — only the runner calls emitResult.
      id: FAIL-003
    - violation: A SIGINT or SIGTERM is received during command execution.
      behavior: >-
        Best-effort cleanup runs; stderr emits `{level:error, code:sigint,
        message:'<SIG> received, exiting'}`; process exits 130. stdout is
        whatever was already written (potentially partial JSON) — consumers MUST
        check exit code.
      id: FAIL-004
    - violation: >-
        A SECOND SIGINT or SIGTERM is received WHILE cleanup is already in
        progress.
      behavior: >-
        The first signal's graceful cleanup is abandoned. The process exits
        IMMEDIATELY with code 130; no further stderr line is guaranteed; on-disk
        artifacts (DB file, locks) may be left behind. Consumers must not assume
        cleanup completed.
      id: FAIL-005
    - violation: >-
        stdout write fails after the command completed successfully (broken pipe
        excepted; disk-full or other IO error).
      behavior: >-
        stderr emits `{level:error, code:stdout-write-failed, message}`; process
        exits 5.
      id: FAIL-006
    - violation: >-
        stdout write encounters EPIPE (downstream consumer closed the pipe, e.g.
        `ed ... | head`).
      behavior: >-
        The runner SILENTLY swallows EPIPE and lets the command return its
        NATURAL exit code (0 on success, 2 on partial-exit, etc.). No
        `stdout-write-failed` line is emitted. Unix-tool convention —
        broken-pipe is a consumer concern, not a producer error.
      id: FAIL-007
    - violation: >-
        JSON encoding of the command result fails (e.g. BigInt, circular
        reference, or other non-serializable value).
      behavior: >-
        stderr emits `{level:error, code:output-encode-failed, message}`;
        process exits 1.
      id: FAIL-008
    - violation: >-
        stderr write itself fails (any exception, not just EPIPE — disk-full,
        EPIPE on stderr, encoding error, etc.).
      behavior: >-
        The runner SILENTLY swallows the exception. Diagnostic output is
        best-effort; a failing stderr channel MUST NOT kill the command. The
        command proceeds to its natural exit code.
      id: FAIL-009
    - violation: >-
        An EXPLICIT config path (`--config` flag) is supplied and the file does
        not exist. (Implicit discovery — no flag, walks upward, falls back to
        defaults if no .emberdeck.jsonc found — does NOT emit this code;
        setup-config-root POST-001 covers the silent fallback.)
      behavior: >-
        stderr emits `{level:error, code:config-missing-file, message}`; process
        exits 6.
      id: FAIL-010
    - violation: Config file is present but cannot be parsed.
      behavior: >-
        stderr emits `{level:error, code:config-parse-error, message}`; process
        exits 2.
      id: FAIL-011
    - violation: >-
        Config file is parsed but contains an invalid value (e.g.
        regressionThreshold outside [0,1], unknown top-level key, wrong type for
        a known field).
      behavior: >-
        stderr emits `{level:error, code:config-validation-error, message}`;
        process exits 2.
      id: FAIL-012
    - violation: >-
        Best-effort cleanup (DB close / temp-file removal) fails. Detection
        PRIMARY path = the signal-handler catch in run; SECONDARY path = the
        final-cleanup catch on normal exit.
      behavior: >-
        stderr emits `{level:warning, code:cleanup-failed, message,
        details?:{stage}}` — note level is WARNING, not error. The warning is
        emitted even under --quiet (see POST-005 exception). The command's
        natural exit code is NOT altered.
      id: FAIL-013
    - violation: >-
        Compensation logic itself fails after a forward action error
        (CompensationError).
      behavior: >-
        stderr emits `{level:error, code:compensation-failed, message,
        details:{originalError, compensationError}}`; process exits 1.
      id: FAIL-014
---
