---
key: cli-surface/command-routing-and-output/commands/init
summary: >-
  Per-command CLI-shape spec for 'ed init'; declares scaffold paths +
  created/skipped shape (POST-001) and exit 0 policy (POST-002).
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
        arguments to this command's action. init can be invoked when no
        emberdeck project exists yet; setupEmberdeck falls back to
        buildDefaultConfig when no config file is present, and the indexed-cache
        handle plus cards directory are auto-created.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` matches the shape:

        ```jsonc

        // stdout shape for `ed init [--project-root] [--cards-dir]
        [--no-gitignore] [--force]`

        {
          projectRoot: string,      // absolute path
          cardsDir:    string,      // absolute path
          configPath:  string,      // absolute path
          glossaryPath:string,      // absolute path
          created: string[],        // cwd-relative paths (human-friendly)
          skipped: string[],        // cwd-relative paths skipped because the target already existed
          gitignoreUpdated: boolean
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): the scaffold succeeded (idempotent; an existing target is
        recorded in skipped[], --force overwrites).

        - thrown mapping: the command itself does not throw emberdeck error
        classes. Node fs errors (the NodeJS.ErrnoException raised by mkdir /
        writeFile / readFile / appendFile / stat) fall through to the toCliError
        default branch → `internal-error` exit 1. Introducing a dedicated IO
        error class would map this to exit 5 (permission/io-error).
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
    - violation: >-
        Directory write permission is missing or another generic fs IO error is
        raised.
      behavior: >-
        stderr emits `{level:'error', code:'internal-error', message,
        details:{class}}` and the process exits 1 (the node fs error falls
        through to the toCliError default branch). A dedicated IO error class
        would let this map to exit 5 (permission / io-error).
      id: FAIL-001
---
