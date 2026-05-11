---
key: cli-surface/project-setup/setup-config-root
summary: >-
  setupEmberdeck plus teardownEmberdeck plus loadConfig plus findPackageRoot own
  the runtime context lifecycle.
status: draft
type: spec
parent: cli-surface/project-setup
codeLinks:
  - kind: function
    file: src/setup.ts
    symbol: setupEmberdeck
  - kind: function
    file: src/setup.ts
    symbol: teardownEmberdeck
  - kind: function
    file: src/config-file.ts
    symbol: loadConfig
  - kind: function
    file: src/config-file.ts
    symbol: loadConfigFromPath
  - kind: function
    file: src/config-file.ts
    symbol: validateRawConfig
  - kind: function
    file: src/config-file.ts
    symbol: mergeCliArgs
  - kind: function
    file: src/config-file.ts
    symbol: buildDefaultConfig
  - kind: function
    file: src/fs/package-root.ts
    symbol: findPackageRoot
  - kind: class
    file: src/setup.ts
    symbol: GildashInitError
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Working directory contains or is below a .emberdeck directory or
        package.json.
      binds:
        - file: src/fs/package-root.ts
          symbol: findPackageRoot
      derives: cli-surface/project-setup#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        setupEmberdeck returns a fully-initialized runtime context with
        config-file overlaid by CLI args.
      keyword: MUST
      binds:
        - file: src/setup.ts
          symbol: setupEmberdeck
        - file: src/config-file.ts
          symbol: mergeCliArgs
      derives: cli-surface/project-setup#G-002
    - id: POST-002
      guarantee: >-
        teardownEmberdeck closes the DB connection and releases resources
        regardless of prior errors.
      keyword: SHALL
      binds:
        - file: src/setup.ts
          symbol: teardownEmberdeck
      derives: cli-surface/project-setup#G-003
    - id: POST-003
      guarantee: >-
        loadConfig throws ConfigError on malformed config rather than silently
        defaulting.
      keyword: MUST
      binds:
        - file: src/config-file.ts
          symbol: loadConfig
        - file: src/config-file.ts
          symbol: validateRawConfig
      derives: cli-surface/project-setup#G-002
  invariants:
    - id: INV-001
      statement: >-
        setupEmberdeck and teardownEmberdeck are paired by the runner; teardown
        always runs.
      binds:
        - file: src/setup.ts
          symbol: setupEmberdeck
        - file: src/setup.ts
          symbol: teardownEmberdeck
      always_holds: cross-call
  failures:
    - violation: No .emberdeck found upward from cwd.
      behavior: setupEmberdeck throws a config-missing error; CLI exit code 6.
      exception:
        class: Error
        file: src/setup.ts
    - violation: .emberdeck/config.yaml is malformed.
      behavior: >-
        loadConfig throws an error identifying the offending field; setup fails
        before DB open.
      exception:
        class: Error
        file: src/config-file.ts
---
