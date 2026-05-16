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
        Working directory contains or is below a .emberdeck directory or
        package.json.
      derives: cli-surface/project-setup#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        setupEmberdeck returns a fully-initialized runtime context with
        config-file overlaid by CLI args.
      keyword: MUST
      derives: cli-surface/project-setup#G-002
    - id: POST-002
      guarantee: >-
        teardownEmberdeck closes the DB connection and releases resources
        regardless of prior errors.
      keyword: SHALL
      derives: cli-surface/project-setup#G-003
    - id: POST-003
      guarantee: >-
        loadConfig throws ConfigError on malformed config rather than silently
        defaulting.
      keyword: MUST
      derives: cli-surface/project-setup#G-002
  invariants:
    - id: INV-001
      statement: >-
        setupEmberdeck and teardownEmberdeck are paired by the runner; teardown
        always runs.
      always_holds: cross-call
  failures:
    - violation: No .emberdeck found upward from cwd.
      behavior: setupEmberdeck throws a config-missing error; CLI exit code 6.
    - violation: .emberdeck.jsonc or .emberdeck.json is malformed.
      behavior: >-
        loadConfig throws an error identifying the offending field; setup fails
        before DB open.
---
