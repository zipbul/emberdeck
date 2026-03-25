---
{key: config-resolution,summary: "Config file priority chain, path resolution, and validation rules",status: active,type: spec,parent: emberdeck,boundary: [src/config-file.ts],relations: [emberdeck],codeLinks: [{kind: function,file: src/config-file.ts,symbol: loadConfig},{kind: function,file: src/config-file.ts,symbol: mergeCliArgs},{kind: function,file: src/config-file.ts,symbol: validateRawConfig}],tags: [contract,config]}
---
## Contracts
- WHEN loading config THEN search order: .emberdeck.jsonc first, then .emberdeck.json, starting from package root
- WHEN no config file found THEN use defaults (cardsDir=.emberdeck/cards, dbPath=.emberdeck/data.db, regressionThreshold=0)
- WHEN config file found THEN all relative paths resolved from config file's directory (not CWD)
- WHEN CLI args provided THEN they override config file values (priority: CLI > file > defaults)
- WHEN unknown key in config THEN reject with VALIDATION_ERROR (strict schema)
- WHEN regressionThreshold outside [0, 1] THEN reject
- WHEN string array field is empty THEN reject (except ignorePatterns and gildashIgnore which allow empty)
- WHEN projectRoot not set THEN gildash is disabled (graceful degradation)

## Cross-module contracts
- gildashIgnore patterns from config are merged with ignorePatterns before passing to gildash indexer
- All resolved paths (cardsDir, dbPath, projectRoot) are guaranteed absolute after loading
- Config validation collects ALL errors before reporting (not fail-fast) — user sees all issues at once