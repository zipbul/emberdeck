---
key: cli-surface/command-routing-and-output/commands/card-export
summary: >-
  Per-command CLI-shape spec for 'ed card export'; declares mode +
  filePath/bytes/content shape (POST-001) and 0/3 exit policy (POST-002).
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

        // stdout shape for `ed card export <key> [--out FILE | --in-place]`

        // exportCardToFile returns { filePath, bytes } uniformly across modes;
        the CLI adds `content` only in stdout mode.

        { key, mode: 'in-place' | 'file' | 'stdout',
          filePath?: string,     // present when mode is 'file' or 'in-place'
          bytes: number,          // byte length of the serialized content (every mode)
          content?: string }      // present only when mode is 'stdout' (jq-friendly)
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): export succeeded (the target file was written, or stdout
        content was populated).

        - thrown mapping: CardNotFoundError → 3 (EXIT.NOT_FOUND); a file-write
        failure in --out/--in-place mode (node fs IO error) falls through to
        internal-error → 1.
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
    - violation: No card exists for the requested key.
      behavior: >-
        stderr emits `{level:'error', code:'card-not-found', message}` and the
        process exits 3.
      id: FAIL-001
      case_of: cli-surface/command-routing-and-output#S-F-01
---
