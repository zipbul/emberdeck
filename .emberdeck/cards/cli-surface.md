---
key: cli-surface
summary: >-
  Command routing, per-command stdout JSON shape, error mapping, exit codes, and
  project setup loading.
status: active
type: domain
glossary:
  - json-envelope
domain:
  overview: >
    Owns everything the user touches: command routing under the ed binary, the
    per-command stdout JSON shape

    contract returned by every command, --quiet behavior, error-class to
    exit-code mapping,

    consistent stderr diagnostics, parsing of --field, --patch, and --from
    inputs, and the project

    setup pipeline (config-file resolution, package-root detection,
    setupEmberdeck and

    teardownEmberdeck) that initializes the runtime context every command
    depends on.
  scope: >
    IN: ed binary command tree, per-command natural JSON shape on stdout (no
    status/data/warnings/errors envelope) with JSON-lines diagnostics on stderr,
    exit-code mapping (0/1/2/3/4/5/6/7/130), --quiet, parse-input helpers,

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
