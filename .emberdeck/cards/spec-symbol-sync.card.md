---
{key: spec-symbol-sync,summary: syncSymbolChanges updates codeLinks for renamed/moved symbols and reports removed ones,status: draft,type: spec,parent: code-binding,boundary: [src/ops/spec-sync.ts],codeLinks: [{kind: function,file: src/ops/spec-sync.ts,symbol: syncSymbolChanges}],glossary: [codeLink,gildash],relations: [code-binding]}
---

## Contracts
- WHEN syncSymbolChanges is called with a since timestamp, THEN gildash.getSymbolChanges MUST be queried for renamed, moved, and removed symbols.
- WHEN a renamed symbol is found in a card's codeLinks, THEN the symbol name MUST be updated in the code link.
- WHEN a moved symbol is found, THEN both file path and symbol name MUST be updated in the code link.
- WHEN a removed symbol is found, THEN it MUST NOT be auto-deleted. It MUST be reported as broken for manual review.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Gildash not configured | GildashNotConfiguredError |
| No matching codeLinks for a change | Change skipped |
| Symbol removed | Reported as broken, link preserved |
