---
{key: config-system,summary: "Configuration loading — JSONC discovery, CLI arg merging, defaults, relation type management",status: draft,type: feature,priority: medium,acceptance: [{id: AC1,description: loadConfig discovers .emberdeck.jsonc/.json from nearest package.json upward,verified: false},{id: AC2,description: validateRawConfig rejects unknown keys with specific error listing offending keys,verified: false},{id: AC3,description: mergeCliArgs overrides config values; paths resolve relative to config file directory,verified: false},{id: AC4,description: buildDefaultConfig returns working config with no config file present,verified: false},{id: AC5,description: addRelationType/removeRelationType are idempotent in-memory mutations,verified: false}],keywords: [config,jsonc,defaults,cli,relation-types],tags: [infra,config],codeLinks: [{kind: function,file: src/config-file.ts,symbol: loadConfig},{kind: function,file: src/config-file.ts,symbol: validateRawConfig},{kind: function,file: src/config-file.ts,symbol: mergeCliArgs},{kind: function,file: src/config-file.ts,symbol: buildDefaultConfig},{kind: function,file: src/config.ts,symbol: addRelationType},{kind: function,file: src/config.ts,symbol: removeRelationType}]}
---
## Why

Config discovery searches for `.emberdeck.jsonc` first, then `.emberdeck.json`, starting from the nearest `package.json` directory (not CWD). JSONC was prioritized because config files benefit from comments (explaining why certain settings exist). If neither file exists, defaults are used silently — no error. This supports zero-config usage where `setupEmberdeck()` just works.

All paths in the config file (cardsDir, dbPath, projectRoot) resolve relative to the config file's directory, not CWD. This ensures configs are portable across machines with different working directories.

Relation types default to `['depends-on', 'references', 'related', 'extends', 'conflicts']`. They can be customized in the config file or mutated at runtime via `addRelationType`/`removeRelationType`. Runtime mutations are in-memory only — not persisted to disk. This was a deliberate choice: runtime customization is for session-specific needs; persistent changes belong in the config file.

`validateRawConfig` uses strict validation — unknown keys are rejected with a specific error listing all offending keys. This prevents typos from being silently ignored (e.g., `cardDir` instead of `cardsDir`).

## Invariants

- Config file search order: `.emberdeck.jsonc` → `.emberdeck.json` → defaults.
- Path resolution is always relative to config file directory (or `package.json` directory if no config).
- `addRelationType` is idempotent — no-op if type already exists.
- `removeRelationType` is idempotent — no-op if type doesn't exist.
- Default relation types are a read-only tuple (`as const`).
- CLI args via `mergeCliArgs()` override config file values unconditionally.

## Scope Boundaries

- Does NOT validate that `cardsDir` or `projectRoot` exist on disk — just stores paths.
- Does NOT create config files — only reads.
- Does NOT persist runtime relation type changes to disk.
- Does NOT initialize gildash or database — that's `setupEmberdeck`.
- Does NOT scan for card files during config loading.
- Empty arrays for `gildashIgnore` or `allowedRelationTypes` are rejected as validation errors.

## Edge Cases

- Both `.emberdeck.jsonc` and `.emberdeck.json` exist: JSONC wins (checked first).
- No `package.json` found: `findPackageRoot` returns CWD, config resolves relative to it.
- Config file has unknown keys: `validateRawConfig` throws listing all unknown keys.
- Config file has invalid JSONC syntax: specific `PARSE_ERROR` code with message.