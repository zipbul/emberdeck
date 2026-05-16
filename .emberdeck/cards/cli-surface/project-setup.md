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
      - statement: Missing teardown leaks SQLite connections between invocations.
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
      given: A working directory with no .emberdeck and no parent .emberdeck.
      when: setupEmberdeck runs.
      then: >-
        A config-missing error (exit 6) is thrown with a hint to initialize the
        project.
      covers:
        - G-001
    - id: S-F-02
      kind: failure
      given: A malformed .emberdeck.jsonc.
      when: loadConfig runs.
      then: A ConfigError is thrown identifying the offending field.
      covers:
        - G-002
  design:
    overview: >
      Project root discovery walks upward from cwd until it finds .emberdeck or
      hits the nearest

      package.json. loadConfig parses the YAML and validates against the
      EmberdeckFileConfig schema.

      mergeCliArgs overlays CLI overrides. setupEmberdeck opens the DB, runs
      migrations, and

      constructs the runtime context.
    components:
      - name: package-root
        responsibility: Walk upward to find project root from cwd.
        interacts_with:
          - setupEmberdeck
      - name: loadConfig
        responsibility: Parse and validate .emberdeck.jsonc or .emberdeck.json.
        interacts_with:
          - mergeCliArgs
      - name: mergeCliArgs
        responsibility: Overlay CLI overrides on file config.
        interacts_with:
          - setupEmberdeck
      - name: setupEmberdeck
        responsibility: Open DB, run migrations, construct runtime context.
        interacts_with:
          - teardownEmberdeck
      - name: teardownEmberdeck
        responsibility: Close DB connection and release any open resources.
        interacts_with: []
    data_flow: []
    invariants:
      - id: DI-001
        statement: setupEmberdeck always returns a fully-initialized context or throws.
      - id: DI-002
        statement: >-
          teardownEmberdeck always closes the DB connection even on prior
          errors.
  policy:
    - id: R-001
      subject: setupEmberdeck
      keyword: MUST
      predicate: discover project root and load config before opening the DB.
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
      statement: Default paths align with the SKILL command table (.emberdeck/ layout).
      reference:
        title: emberdeck SKILL onboarding workflow
        locator: >-
          /home/revil/projects/zipbul/emberdeck/.claude/skills/emberdeck/SKILL.md
  compatibility:
    guarantees:
      - subject: setupEmberdeck and teardownEmberdeck public signatures
        version_range: 1.x
        breaks_if: A new required option is added without a default.
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
        predicate: Missing .emberdeck causes exit code 6 with a config-missing error.
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
---
