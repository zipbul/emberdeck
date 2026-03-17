---
{key: mcp-server,summary: "MCP tool registration — structural typing, Zod schemas, context lifecycle, graceful shutdown",status: draft,type: feature,priority: critical,acceptance: [{id: AC1,description: registerEmberdeckTools registers all ops with Zod input schemas on McpServerLike,verified: false},{id: AC2,description: update_card .strict() rejects unknown input keys,verified: false},{id: AC3,description: setupEmberdeck initializes DB + repos + optional gildash with graceful degradation,verified: false},{id: AC4,description: "teardownEmberdeck closes gildash then DB, safe to call with undefined gildash",verified: false},{id: AC5,description: validate_code_links accepts optional key for batch validation of all cards,verified: false}],keywords: [mcp,tools,zod,setup,teardown,gildash,lifecycle],tags: [infra,mcp],relations: [{type: depends-on,target: card-crud},{type: depends-on,target: card-queries},{type: depends-on,target: code-links},{type: depends-on,target: analysis},{type: depends-on,target: card-sync},{type: depends-on,target: config-system}],codeLinks: [{kind: function,file: src/mcp/tools.ts,symbol: registerEmberdeckTools},{kind: function,file: src/setup.ts,symbol: setupEmberdeck},{kind: function,file: src/setup.ts,symbol: teardownEmberdeck}]}
---
## Why

MCP tool registration uses structural typing (`McpServerLike` interface) instead of importing `@modelcontextprotocol/sdk` directly. This decouples emberdeck from the SDK version — any MCP server implementation with a compatible `registerTool(name, config, callback)` signature works. The SDK is an optional peer dependency, not a hard requirement.

Each tool wraps an ops-layer function with try-catch. Success returns `ok({ data })` (JSON stringified), errors return `fail(err)` with `isError: true`. This pattern ensures MCP protocol compliance without leaking internal error types.

`update_card` uses `.strict()` on its Zod schema to reject unknown keys. This was added because agents were wrapping fields in a `{ fields: { body: "..." } }` object instead of flat params `{ body: "..." }` — the update silently did nothing. `.strict()` makes this fail with a Zod validation error.

`validate_code_links` accepts optional `key` — omit to validate all cards at once (batch mode). This was added to reduce the N tool calls required when checking multiple cards after a multi-file change.

`setupEmberdeck` initializes DB, creates all 5 repository instances, and optionally opens gildash. Gildash initialization is failure-tolerant — if `Gildash.open()` fails, gildash is silently set to undefined and code-link features are disabled. This supports graceful degradation: emberdeck works without gildash, just without symbol resolution.

`teardownEmberdeck` closes gildash (async) then DB (sync). Must be awaited before process exit.

## Invariants

- All tools return `{ content: [{ type: 'text', text: JSON.stringify(data) }] }` on success.
- All tools return `{ content: [{ type: 'text', text: errorMessage }], isError: true }` on failure.
- `update_card` rejects unknown input keys via `.strict()`.
- `validate_code_links` with no key validates all cards, skipping those whose files are missing.
- `setupEmberdeck` always creates all 5 repositories — none are null.
- Gildash is set to undefined (not null) when not configured or when initialization fails.

## Scope Boundaries

- Does NOT expose raw DB queries — only ops-layer functions.
- Does NOT manage MCP server lifecycle — caller owns server creation and transport.
- Does NOT include internal utilities or repository implementations.
- Does NOT validate MCP protocol compliance — assumes SDK handles framing.
- Tool descriptions guide agent behavior but do NOT enforce body quality at the tool level.

## Edge Cases

- `setupEmberdeck` with invalid `projectRoot`: gildash silently disabled, no error.
- `teardownEmberdeck` with undefined gildash: safely skips gildash close.
- `validate_code_links` batch mode with no cards: returns empty object `{}`.
- `update_card` with `{ key: "x", fields: { body: "y" } }`: Zod `.strict()` rejects `fields` key.