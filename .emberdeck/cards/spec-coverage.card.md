---
{key: spec-coverage,summary: "getLinkCoverage, getUncoveredSymbols, and suggestCardScope analyze code-spec traceability gaps",status: draft,type: spec,parent: code-binding,boundary: [src/ops/spec-sync.ts],codeLinks: [{kind: function,file: src/ops/spec-sync.ts,symbol: getLinkCoverage},{kind: function,file: src/ops/spec-sync.ts,symbol: getUncoveredSymbols},{kind: function,file: src/ops/spec-sync.ts,symbol: suggestCardScope}],glossary: [codeLink,gildash,boundary,card],relations: [code-binding]}
---

## Contracts
- WHEN getLinkCoverage is called for a card, THEN declared/resolved/broken counts MUST be returned, and unreferenced symbols in the same files MUST be listed (excluding boundary-covered and ignored files).
- WHEN getUncoveredSymbols is called, THEN all gildash-indexed symbols not covered by any card's codeLinks or boundary MUST be returned, with ignorePatterns applied.
- WHEN suggestCardScope is called, THEN uncovered symbols MUST be grouped by directory, and suggestions MUST include type (brief for multi-file dirs, spec for single-file), parent (nearest ancestor with a card), boundary pattern, and matching glossary words.
- WHEN a directory is already covered by an existing boundary glob, THEN it MUST be skipped in suggestions.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Gildash not configured | GildashNotConfiguredError |
| Invalid boundary JSON on card | Skipped during boundary expansion |
| No symbols in a file | File skipped in coverage |
