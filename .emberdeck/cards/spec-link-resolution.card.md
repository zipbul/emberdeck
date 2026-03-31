---
{key: spec-link-resolution,summary: "Code link resolution, validation with auto-drift, and symbol/boundary-based card lookup",status: draft,type: spec,parent: code-binding,boundary: [src/ops/link.ts],codeLinks: [{kind: function,file: src/ops/link.ts,symbol: resolveCardCodeLinks},{kind: function,file: src/ops/link.ts,symbol: validateCodeLinks},{kind: function,file: src/ops/link.ts,symbol: findCardsBySymbol},{kind: function,file: src/ops/link.ts,symbol: findAffectedCards},{kind: function,file: src/ops/link.ts,symbol: ensureReindexed}],glossary: [codeLink,gildash,drift,boundary],relations: [code-binding]}
---

## Contracts
- WHEN resolveCardCodeLinks is called, THEN each codeLink MUST be looked up via gildash searchSymbols with exact match on symbol name and file path. GildashNotConfiguredError MUST be thrown if gildash is unavailable.
- WHEN validateCodeLinks finds broken links on an active card, THEN the card MUST be auto-transitioned to drifted (DB UPDATE + file write, with file-failure compensation).
- WHEN validateCodeLinks runs on a draft card, THEN broken links MUST be reported as planned (not broken), and no auto-transition occurs.
- WHEN gildash is transiently unavailable during validateCodeLinks, THEN links MUST be reported as gildash-unavailable and auto-transition MUST be skipped.
- WHEN findCardsBySymbol is called, THEN codeLink-based matches MUST be checked first, followed by boundary glob matches (only when filePath is provided).
- WHEN findAffectedCards is called with changed files, THEN all cards with codeLinks referencing those files MUST be returned.
- WHEN ensureReindexed is called, THEN gildash.reindex MUST be called if available (no-op otherwise).

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Gildash not configured | GildashNotConfiguredError |
| Gildash search throws | Link treated as unresolved (null symbol) |
| Auto-drift file write fails | DB reverted to previous status |
| Auto-drift DB update fails | Transition skipped |
