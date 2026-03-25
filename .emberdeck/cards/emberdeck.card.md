---
{key: emberdeck,summary: "Emberdeck purpose, scope, and boundaries",status: active,type: intent,tags: [core,scope]}
---
## Why
AI agents lose design context between conversations. Code comments and docstrings capture "what" but not "why" — decisions, constraints, tradeoffs, and scope boundaries vanish when a conversation ends. Without persistent design memory, agents repeat mistakes, violate constraints they were told about previously, and fail to detect cascading impact of changes.

## Scope
- Card-based design knowledge storage (intent + spec types)
- Code-to-card linking via symbol index (gildash)
- Drift detection and impact analysis
- MCP tool interface for AI agent consumption

## Excluded
- Code generation or modification — Emberdeck reads code, never writes it
- Runtime monitoring or telemetry
- Human-facing UI — MCP tools are the sole interface
- Version control integration — no git hooks, no branch awareness
- Collaborative editing — single-agent model, serialized writes

## Decisions
- SQLite + file dual storage: DB for queries and relationships, markdown files for human-readable body content and version control diffs
- MCP protocol chosen as interface: agents already speak MCP, no custom integration needed
- Gildash for symbol indexing: external dependency, gracefully optional — all core operations work without it