---
key: cli-surface/command-routing-and-envelope/runner-and-output
summary: >-
  run wraps every subcommand action; ok, partial, err, unknown, and render build
  and emit the JSON envelope.
status: draft
type: spec
parent: cli-surface/command-routing-and-envelope
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: A commander.js subcommand action wraps its body in run with a CommandFn.
      derives: cli-surface/command-routing-and-envelope#G-001
  postconditions:
    - id: POST-001
      guarantee: Every subcommand emits the documented envelope on stdout via render.
      keyword: MUST
      derives: cli-surface/command-routing-and-envelope#G-001
    - id: POST-002
      guarantee: >-
        statusToExitCode maps status to documented exit codes (0 / 1 / 2 / 3 / 4
        / 5 / 6 / 7).
      keyword: SHALL
      derives: cli-surface/command-routing-and-envelope#G-002
    - id: POST-003
      guarantee: >-
        resolveOutputMode returns quiet when --quiet is set so render emits only
        the data key.
      keyword: MUST
      derives: cli-surface/command-routing-and-envelope#G-003
    - id: POST-004
      guarantee: >-
        Per-file sync failures returned from ensureCardsSynced are surfaced on
        result.warnings as CARD_SYNC_FAILED entries when they would otherwise be
        invisible to the user. This holds on BOTH the success path (after fn(rt)
        returns) and the catch path (after fn(rt) throws and the envelope is
        synthesized from the toCliError result), so a thrown command never
        silently drops auto-sync diagnostics. A failure whose filePath already
        appears in the command's errors[].details.file_path is suppressed so
        the same root cause is reported exactly once. Whether suppressed or
        surfaced, CARD_SYNC_FAILED entries are informational only and do not
        alter result.status or the exit code.
      keyword: MUST
      derives: cli-surface/command-routing-and-envelope#G-001
  invariants:
    - id: INV-001
      statement: >-
        Every catchable error class is mapped through toCliError to a CliMessage
        with a stable code.
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
        Commander-side contract for the CARD_SYNC_FAILED dedup: any command
        that surfaces per-file errors in result.errors[] MUST populate the
        offending file's path on details.file_path (as a string). The runner
        uses this key — and only this key — to suppress the duplicate auto-sync
        warning. Commands that emit per-file errors without details.file_path
        silently regress the dedup contract.
      always_holds: cross-call
  failures:
    - violation: An unmapped error class is thrown inside the action.
      behavior: >-
        classifyErrorStatus returns unknown; render emits status=unknown and
        exit code 1.
    - violation: >-
        ensureCardsSynced throws (e.g. DB write failure at the schema layer, not
        a per-file parse error).
      behavior: >-
        The error propagates through the run try/catch, is mapped via
        toCliError, and surfaces as a normal envelope error; no partial command
        execution occurs.
---
