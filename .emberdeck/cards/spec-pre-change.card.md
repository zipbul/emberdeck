---
{key: spec-pre-change,summary: preChangeCheck finds affected cards via 3 mechanisms and classifies risk level,status: draft,type: spec,parent: impact-analysis,boundary: [src/ops/impact.ts],codeLinks: [{kind: function,file: src/ops/impact.ts,symbol: preChangeCheck}],glossary: [card,codeLink,boundary],relations: [impact-analysis]}
---

## Contracts
- WHEN preChangeCheck is called with file paths, THEN affected cards MUST be found via 3 mechanisms: (1) direct codeLink file match, (2) boundary glob match, (3) BFS backward traversal of relations up to depth 3.
- WHEN symbols are specified, THEN only codeLinks matching both file AND symbol MUST count as direct matches.
- WHEN risk level is calculated, THEN: critical = 5+ affected or >50% drifted, high = 3+ or >25% drifted, medium = 1+, low = 0 affected.
- WHEN files are not covered by any card's codeLinks or boundary, THEN they MUST appear in newUncoveredFiles (after applying ignorePatterns).
- WHEN the project glossary has entries, THEN the full glossary MUST be attached to the result.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| No gildash available | Link status computation returns undefined |
| Invalid boundary JSON | Card skipped in boundary matching |
| No affected cards | riskLevel=low, empty arrays |
