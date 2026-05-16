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
        Working directory contains or is below a package.json or an existing
        .emberdeck.jsonc / .emberdeck.json config file.
      derives: cli-surface/project-setup#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        setupEmberdeck returns a fully-initialized runtime context with the
        on-disk config (.emberdeck.jsonc or .emberdeck.json) overlaid by CLI
        args via mergeCliArgs; a missing config file falls back to
        buildDefaultConfig (no config-missing error).
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
        loadConfig returns a Result<EmberdeckFileConfig, ConfigError>; on Err
        the caller (context build) raises ConfigLoadError carrying the
        underlying ConfigError code. The code map is FILE_NOT_FOUND → kebab
        `config-missing-file` → exit 6, PARSE_ERROR → kebab `config-parse-error`
        → exit 2, VALIDATION_ERROR → kebab `config-validation-error` → exit 2.
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
        Neither a config file nor a writable package.json is present upward from
        cwd.
      behavior: >-
        setupEmberdeck rejects with a ConfigLoadError mapped to kebab
        `config-missing-file`; the CLI runner emits stderr `{level:'error',
        code:'config-missing-file', message}` and exits 6.
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
