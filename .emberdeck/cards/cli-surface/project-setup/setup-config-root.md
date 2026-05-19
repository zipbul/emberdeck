---
key: cli-surface/project-setup/setup-config-root
summary: >-
  setupEmberdeck plus teardownEmberdeck plus loadConfig plus findPackageRoot own
  the runtime context lifecycle.
status: active
type: spec
parent: cli-surface/project-setup
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Working directory is any path. setupEmberdeck walks upward looking for
        `.emberdeck.jsonc`/`.emberdeck.json` and/or `package.json`; if neither
        is found it falls back to cwd as the project root and buildDefaultConfig
        for the config.
      derives: cli-surface/project-setup#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        setupEmberdeck returns a fully-initialized runtime context with the
        on-disk config (.emberdeck.jsonc or .emberdeck.json) overlaid by CLI
        args via mergeCliArgs; a missing config file falls back to
        buildDefaultConfig with cwd as project root (no config-missing error in
        the implicit-discovery path).
      keyword: MUST
      derives: cli-surface/project-setup#G-002
    - id: POST-002
      guarantee: >-
        teardownEmberdeck closes the indexed-cache connection and releases the
        code-index handle regardless of prior errors; setupEmberdeck closes the
        partial cache handle on every error path before returning.
      keyword: SHALL
      derives: cli-surface/project-setup#G-003
    - id: POST-003
      guarantee: >-
        loadConfig returns a Result<EmberdeckFileConfig, ConfigError>. On Err:
        PARSE_ERROR → kebab `config-parse-error` → exit 2; VALIDATION_ERROR →
        kebab `config-validation-error` → exit 2. FILE_NOT_FOUND maps to
        `config-missing-file` → exit 6 only when an EXPLICIT config path is
        supplied via the `--config` flag. The default discovery walk never emits
        config-missing-file because it falls back to buildDefaultConfig.
      keyword: MUST
      derives: cli-surface/project-setup#G-002
    - id: POST-004
      guarantee: >-
        validateRawConfig rejects unknown top-level keys, wrong-typed known
        keys, and out-of-range numeric fields (regressionThreshold must be in
        [0, 1]); any violation surfaces as a VALIDATION_ERROR ConfigError that
        propagates through loadConfig as Err.
      keyword: MUST
      derives: cli-surface/project-setup#G-002
  invariants:
    - id: INV-001
      statement: >-
        setupEmberdeck and teardownEmberdeck are paired by the runner; teardown
        always runs in the finally block, even on setup or command-action
        failure.
      always_holds: cross-call
    - id: INV-002
      statement: >-
        Unknown top-level keys in the config file are a strict rejection (no
        silent ignore); only the documented KNOWN_TOP_KEYS set is accepted.
      always_holds: per-call
  failures:
    - violation: >-
        An explicit config path is supplied via `--config` flag and the file
        does not exist.
      behavior: >-
        loadConfig returns Err{code: FILE_NOT_FOUND}; context build raises
        ConfigLoadError → stderr `{level:error, code:config-missing-file,
        message}` → exit 6. (Implicit discovery does NOT trigger this — it
        silently falls back to defaults.)
    - violation: The config file is present but its JSON/JSONC syntax cannot be parsed.
      behavior: >-
        loadConfig returns Err{code: PARSE_ERROR}; context build raises
        ConfigLoadError → stderr `{level:'error', code:'config-parse-error',
        message}` → exit 2.
    - violation: >-
        The config file parses but a value is invalid (unknown top-level key,
        wrong type for a known key, regressionThreshold outside [0,1]).
      behavior: >-
        loadConfig returns Err{code: VALIDATION_ERROR}; context build raises
        ConfigLoadError → stderr `{level:'error',
        code:'config-validation-error', message}` → exit 2.
    - violation: >-
        The code-index dependency fails to initialize (e.g. its data directory
        cannot be created).
      behavior: >-
        setupEmberdeck closes any partially-opened indexed-cache handle and
        raises GildashInitError → stderr `{level:'error',
        code:'gildash-init-failed', message}` → exit 6.
---
