---
key: cli-surface
summary: >-
  Command routing, JSON-envelope output, error mapping, exit codes, and project
  setup loading.
status: draft
type: domain
glossary:
  - json-envelope
domain:
  overview: >
    Owns everything the user touches: command routing under the ed binary, the
    JSON-envelope output

    contract returned by every command, --quiet behavior, error-class to
    exit-code mapping,

    consistent stderr diagnostics, parsing of --field, --patch, and --from
    inputs, and the project

    setup pipeline (config-file resolution, package-root detection,
    setupEmberdeck and

    teardownEmberdeck) that initializes the runtime context every command
    depends on.
  scope: >
    IN: ed binary command tree, JSON-envelope shape with schemaVersion plus
    status plus data plus

    warnings plus errors, exit-code mapping (0/1/2/3/4/5/6/7/130), --quiet,
    parse-input helpers,

    output formatting, CliRuntime construction, config file loader, default
    cards directory and DB

    path, setup and teardown lifecycle.


    OUT: business logic of any command (delegated to ops domains).
  cross_domain_dependencies:
    - domain: card-lifecycle
      relationship: invokes write operations from card subcommands.
    - domain: card-storage
      relationship: invokes read operations from card subcommands.
    - domain: code-binding
      relationship: invokes link, spec, and check subcommands.
    - domain: analysis
      relationship: >-
        invokes check drift, impact, regression, interactions, and analyze
        subcommands.
    - domain: glossary
      relationship: invokes glossary subcommands.
---
