---
key: cli-surface/project-setup
summary: >-
  Project root discovery, config-file loading, and setupEmberdeck plus
  teardownEmberdeck lifecycle that initializes the runtime context.
status: active
type: brief
parent: cli-surface
glossary:
  - json-envelope
brief:
  context:
    problem: >
      Every subcommand needs a consistent runtime context (project root, cards
      directory, DB path,

      gildash adapter). Without a centralized setup pipeline each command would
      re-implement

      config resolution, drifting in defaults and behavior.
    impact:
      - statement: >-
          Inconsistent project-root resolution causes commands to operate on
          different DBs without warning.
      - statement: Missing teardown leaks store connections between invocations.
  scope:
    goals:
      - id: G-001
        statement: >-
          Discover the project root from the working directory upward to the
          nearest .emberdeck or package.json.
      - id: G-002
        statement: >-
          Load .emberdeck.jsonc or .emberdeck.json when present and merge with
          CLI flags.
      - id: G-003
        statement: >-
          Provide setupEmberdeck and teardownEmberdeck that own the runtime
          lifecycle including DB connection open and close.
    non_goals:
      - id: NG-001
        statement: Cross-project federation.
      - id: NG-002
        statement: Hot-reload on config change.
    assumptions:
      - id: A-001
        statement: >-
          Default cards directory is .emberdeck/cards and default DB is
          .emberdeck/data.db.
        verification: Inspect DEFAULT_CARDS_DIR and DEFAULT_DB_PATH constants.
        reevaluate_when: A user requests overriding without explicit config.
  flow:
    - id: S-H-01
      kind: happy
      given: A working directory inside a project with .emberdeck.jsonc present.
      when: setupEmberdeck runs.
      then: >-
        A runtime context is returned with config-file values overridden by CLI
        flags.
      covers:
        - G-001
        - G-002
        - G-003
    - id: S-H-02
      kind: happy
      given: A successful subcommand invocation.
      when: The subcommand completes.
      then: teardownEmberdeck closes the DB connection without leaking handles.
      covers:
        - G-003
    - id: S-F-01
      kind: failure
      given: >-
        A working directory with no .emberdeck and no parent .emberdeck AND no
        explicit --config / EMBERDECK_CONFIG path is supplied.
      when: setupEmberdeck runs.
      then: >-
        Implicit discovery silently falls back to cwd as project root with
        buildDefaultConfig; NO config-missing error is thrown. Only when an
        EXPLICIT config path is supplied does FILE_NOT_FOUND →
        config-missing-file → exit 6.
      covers:
        - G-001
    - id: S-F-02
      kind: failure
      given: A malformed .emberdeck.jsonc.
      when: loadConfig runs.
      then: A ConfigError is thrown identifying the offending field.
      covers:
        - G-002
  policy:
    - id: R-001
      subject: setupEmberdeck
      keyword: MUST
      predicate: >-
        discover project root by walking upward; when no
        .emberdeck/.emberdeck.jsonc is found, silently fall back to cwd +
        buildDefaultConfig (no config-missing error in implicit-discovery).
        FILE_NOT_FOUND → exit 6 only when an explicit config path is supplied
        (--config / EMBERDECK_CONFIG).
      governs:
        - S-H-01
        - S-F-01
    - id: R-002
      subject: teardownEmberdeck
      keyword: SHALL
      predicate: be invoked by the CLI runner regardless of subcommand outcome.
      governs:
        - S-H-02
    - id: R-003
      subject: loadConfig
      keyword: MUST
      predicate: >-
        throw ConfigError on malformed input rather than silently defaulting
        fields.
      governs:
        - S-F-02
  external:
    - id: C-001
      statement: >-
        Default paths (the .emberdeck/ layout) align with the project's CLI
        surface conventions.
      reference:
        title: domain cli-surface
        locator: cli-surface
  limits:
    - id: KL-001
      statement: >-
        Config-file changes during a running command are not picked up; restart
        is required.
    - id: KL-002
      statement: >-
        Project root discovery stops at the first .emberdeck found upward;
        nested projects are not auto-detected.
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: >-
          An EXPLICIT config path (--config flag or EMBERDECK_CONFIG) that
          points at a missing file causes exit code 6 with a config-missing
          error; implicit discovery (no explicit path) silently falls back to
          cwd as project root with no config-missing error.
        method: CLI integration test from a non-project directory.
      verifies:
        - S-F-01
    - id: SC-002
      type: binary
      measure:
        predicate: teardownEmberdeck releases the DB connection.
        method: Resource leak test that asserts open handle count.
      verifies:
        - S-H-02
        - S-H-01
        - S-F-02
  rationale:
    alternatives:
      - option: Implicit context construction inside each command.
        pros:
          - No central pipeline.
        cons:
          - Defaults drift across commands.
      - option: Long-lived daemon process.
        pros:
          - Faster invocations.
        cons:
          - >-
            Adds a server lifecycle that conflicts with the simple CLI
            deployment.
    chosen:
      option: Single setup/teardown pair invoked by the runner per command.
      reasoning: >-
        Matches single-user CLI deployment, gives consistent context, no daemon
        complexity.
    addresses:
      - KL-001
      - KL-002
  approach: >-
    Startup discovers the project root by walking upward from the working
    directory until an emberdeck marker or the nearest package boundary is
    found, parses and validates the JSON or JSONC config against the config
    schema, and overlays any CLI overrides. Setup then opens the database, runs
    migrations, and constructs a fully-initialized runtime context — it either
    returns that context or throws, never a partial one. Teardown always closes
    the database connection and releases open resources, even when a prior error
    occurred.
---
