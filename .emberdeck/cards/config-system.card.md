---
{key: config-system,summary: "Configuration system: JSONC config file loading, validation, defaults, CLI arg merging, and context initialization",status: draft,type: decision,priority: medium,acceptance: [{id: ac-1,description: Config file is searched as .emberdeck.jsonc or .emberdeck.json from CWD or package root.,verified: true},{id: ac-2,description: JSONC format (comments allowed) is parsed with Bun.JSONC.parse.,verified: true},{id: ac-3,description: "Validation rejects unknown keys, wrong types, and empty arrays. All errors are collected and reported at once.",verified: true},{id: ac-4,description: "Defaults: cardsDir=.emberdeck/cards, dbPath=.emberdeck/data.db, allowedRelationTypes=[depends-on, references, related, extends, conflicts].",verified: true},{id: ac-5,description: "Paths in config are resolved relative to the config file location, not CWD.",verified: true},{id: ac-6,description: CLI args override config file values via mergeCliArgs.,verified: true},{id: ac-7,description: "setupEmberdeck creates the full EmberdeckContext: DB connection, all repositories, and optional gildash instance.",verified: true},{id: ac-8,description: teardownEmberdeck closes gildash and the SQLite connection. Must be called before process exit.,verified: true},{id: ac-9,description: "If gildash initialization fails, it is set to undefined silently. Code link features are disabled but everything else works.",verified: true}],keywords: [loadConfig,EmberdeckOptions,EmberdeckContext,setupEmberdeck,teardownEmberdeck,JSONC,EmberdeckFileConfig],tags: [core,config,setup],relations: [{type: related,target: persistence}],codeLinks: [{kind: function,file: src/config-file.ts,symbol: loadConfig},{kind: function,file: src/config-file.ts,symbol: loadConfigFromPath},{kind: function,file: src/config-file.ts,symbol: validateRawConfig},{kind: function,file: src/config-file.ts,symbol: mergeCliArgs},{kind: function,file: src/config-file.ts,symbol: buildDefaultConfig},{kind: function,file: src/setup.ts,symbol: setupEmberdeck},{kind: function,file: src/setup.ts,symbol: teardownEmberdeck},{kind: type,file: src/config.ts,symbol: EmberdeckContext},{kind: type,file: src/config.ts,symbol: EmberdeckOptions}]}
---
## Rationale

The config system is the entry point for all emberdeck usage. It must handle three scenarios:

1. **Library usage**: Caller provides `EmberdeckOptions` directly to `setupEmberdeck()`
2. **CLI usage**: Config is loaded from `.emberdeck.jsonc`, optionally overridden by CLI args
3. **MCP server usage**: Config is loaded automatically, then passed to `registerEmberdeckTools()`

### Why JSONC?

JSON with comments allows documenting configuration decisions inline. Bun has built-in `Bun.JSONC.parse`, so there's no extra dependency. The `.jsonc` extension gets proper syntax highlighting in editors.

### Why Result pattern for config loading?

Config errors are expected (file not found, parse error, validation error). Using `Result<T, ConfigError>` instead of throwing allows callers to handle errors without try/catch. The error codes (`FILE_NOT_FOUND`, `PARSE_ERROR`, `VALIDATION_ERROR`) enable programmatic error handling.

## Key Invariants

- **Path resolution**: All paths in the config file are resolved relative to the config file's directory, not the current working directory. This makes configs portable across different working directories.
- **Unknown key rejection**: Any key not in the known set is an error. This prevents silent typos (e.g., `cardDir` instead of `cardsDir`).
- **No config file = defaults**: When no config file is found, `buildDefaultConfig` creates a valid config using convention-over-configuration defaults. This enables zero-config usage.
- **Context lifecycle**: `setupEmberdeck` creates everything, `teardownEmberdeck` destroys everything. The context is the single source of all runtime state.
- **Gildash failure isolation**: Gildash init failure is caught and silenced. This is critical for CI environments where the project root may not have a gildash-compatible structure.

## Scope Boundaries

- This card covers initialization and configuration only. Runtime behavior is in other cards.
- The 5 default relation types (depends-on, references, related, extends, conflicts) are defined in `config.ts`. Custom types are additive via `allowedRelationTypes` config or `addRelationType()` at runtime.
- The `EmberdeckContext` type is intentionally opaque to callers. They should not access `.db` or repositories directly — all operations go through the ops layer.
