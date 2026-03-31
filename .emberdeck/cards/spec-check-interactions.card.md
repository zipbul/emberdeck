---
{key: spec-check-interactions,summary: "checkInteractions detects shared symbols, shared files, import dependencies, and undefined relations between cards",status: draft,type: spec,parent: drift-detection,boundary: [src/ops/context.ts],codeLinks: [{kind: function,file: src/ops/context.ts,symbol: checkInteractions}],glossary: [card,codeLink,boundary],relations: [drift-detection]}
---

## Contracts
- WHEN checkInteractions is called with card keys, THEN every pair MUST be analyzed for: shared symbols (same file+symbol in both cards' codeLinks), shared files (both cards link to same file), import dependencies (via gildash getDependencies), and existing relations.
- WHEN two cards share code links to the same file but have no defined relation, THEN a potential conflict MUST be reported.
- WHEN shared symbols exist without a relation, THEN an undefinedRelation suggestion MUST be generated.
- WHEN gildash getDependencies is unavailable, THEN import dependency detection MUST gracefully return empty results.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| gildash getDependencies unavailable | Import dependencies empty, other checks proceed |
| Card key not found in DB | Skipped in link map (no codeLinks) |
| Invalid boundary JSON on a card | Skipped during file set expansion |
