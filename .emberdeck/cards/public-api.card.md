---
{key: public-api,summary: "Public API barrel — export surface decisions, what is exposed vs hidden",status: draft,type: feature,priority: medium,acceptance: [{id: AC1,description: All public operations accessible via import from package root,verified: false},{id: AC2,description: Repository interfaces exported; implementations hidden,verified: false},{id: AC3,description: Error classes re-exported for consumer catch blocks,verified: false},{id: AC4,description: No third-party types leaked through public API,verified: false}],keywords: [api,barrel,exports,public,surface],tags: [infra,api],relations: [{type: references,target: card-crud},{type: references,target: card-queries},{type: references,target: code-links},{type: references,target: analysis},{type: references,target: mcp-server}],codeLinks: [{kind: defines,file: index.ts,symbol: setupEmberdeck}]}
---
## Why

The barrel file (`index.ts`) defines the package boundary. Everything exported here is a public API commitment — removing or changing it is a breaking change. Everything NOT exported is an implementation detail that can change freely.

Repository implementations (e.g., `DrizzleCardRepository`) are hidden; only the interfaces (`CardRepository`, `RelationRepository`) are exported. This allows consumers to mock repositories for testing without depending on SQLite or Drizzle. The alternative — exporting concrete classes — would couple consumers to the persistence implementation.

`safe.ts` exports (`withRetry`, `withCardLock`, `safeWriteOperation`) ARE exposed because they're useful building blocks for consumers implementing custom operations on top of emberdeck. They're concurrency primitives, not internal details.

DB connection (`migrateEmberdeck`, `EmberdeckDb`) is exported for CLI integration — the CLI needs direct DB access for setup commands. This is intentional leakage for a specific use case.

## Invariants

- All public operations (create, update, delete, query, sync, link, analysis) are accessible from package root import.
- All public types (CardFile, CodeLink, CardStatus, etc.) are re-exported.
- All error classes are re-exported (consumers need them for catch blocks).
- Pure utilities (normalizeSlug, parseCardMarkdown, validateCardInput) are re-exported.

## Scope Boundaries

- Does NOT export individual repository implementations (DrizzleCardRepository, etc.).
- Does NOT export DB schema or Drizzle table definitions.
- Does NOT export internal helpers or small utility functions.
- Does NOT export MCP SDK types (McpServerLike is internal).
- Does NOT re-export third-party dependencies (Zod, Drizzle).

## Design Decisions

- Flat export structure (no nested namespaces like `emberdeck.ops.create`). Chosen for simplicity and tree-shaking compatibility.
- Type exports use `export type` where possible to avoid runtime import side effects.
- `registerEmberdeckTools` is the only MCP-related export — consumers bring their own McpServer instance.