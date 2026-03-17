---
{key: mcp-server,summary: "MCP tool registration: exposes all emberdeck operations as MCP tools with zod v4 schemas and structured JSON responses",status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: registerEmberdeckTools is a single function that registers all tools on a McpServer instance.,verified: true},{id: ac-2,description: "All tools return JSON via the ok() helper (content: [{type: 'text', text: JSON.stringify(data, null, 2)}]).",verified: true},{id: ac-3,description: "Errors are caught and returned via fail() with isError: true, not thrown.",verified: true},{id: ac-4,description: "Tool input schemas use zod v4 (imported from 'zod/v4').",verified: true},{id: ac-5,description: "@modelcontextprotocol/sdk is an optional peer dependency. The MCP module is only imported when the SDK is available.",verified: true},{id: ac-6,description: "Tool descriptions follow AX principles: they describe the tool's role and when to use it, not just what it does.",verified: true},{id: ac-7,description: Every public ops function has a corresponding MCP tool with the emberdeck_ prefix.,verified: true}],keywords: [registerEmberdeckTools,MCP,McpServer,zod,tool-registration],tags: [integration,mcp,api],relations: [{type: depends-on,target: card-crud},{type: depends-on,target: card-queries},{type: depends-on,target: code-links},{type: depends-on,target: analysis},{type: depends-on,target: config-system}],codeLinks: [{kind: function,file: src/mcp/tools.ts,symbol: registerEmberdeckTools}]}
---
## Rationale

The MCP layer is the primary interface for AI agents to interact with emberdeck. It wraps the TypeScript API into the MCP tool protocol, which AI assistants (Claude, etc.) can call directly.

### Why a Single Registration Function?

`registerEmberdeckTools(server, ctx)` registers all tools at once. This was chosen over per-tool registration because:
- The MCP server is initialized once at startup
- All tools share the same `EmberdeckContext`
- Adding a new tool is a single addition to one file, not a new module

### Why zod v4?

The `@modelcontextprotocol/sdk` requires zod for tool input schema definition. Emberdeck uses `zod/v4` (the modern import path) to avoid compatibility issues with the SDK's schema conversion.

### Error Handling: Return, Don't Throw

MCP tools should never throw. All errors are caught in each tool handler and returned as `{ isError: true, content: [{ type: 'text', text: errorMessage }] }`. This ensures the AI agent always gets a useful error message rather than a protocol-level failure.

## Key Invariants

- **1:1 mapping**: Every function exported from `index.ts` operations has a corresponding MCP tool. No hidden functionality.
- **No business logic in tools.ts**: The MCP layer is purely a thin adapter. Input parsing (zod), calling the ops function, and output formatting (ok/fail) is all it does.
- **Shared schemas**: Common zod schemas (relationSchema, codeLinkSchema, acceptanceSchema) are defined once and reused across tools to keep definitions DRY.
- **Optional dependency**: The MCP module imports from `@modelcontextprotocol/sdk` which is an optional peer dep. Projects that don't use MCP don't need to install it.

## Scope Boundaries

- This card covers the MCP tool registration only. The CLI (`cli.ts`) is a separate entry point that uses the same ops functions but with different I/O.
- Tool descriptions are written for AI agents, not humans. They follow the project's AX (Agent Experience) principles: role-based descriptions, usage hints, and input tolerance guidance.
- The MCP server itself (transport, lifecycle) is configured by the host process, not by emberdeck. `registerEmberdeckTools` only registers tools on an existing server instance.
