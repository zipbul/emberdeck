---
{key: code-link-contract,summary: "Code link resolution, deduplication, and no-auto-delete policy",status: active,type: spec,parent: drift-lifecycle,codeLinks: [{kind: function,file: src/ops/link.ts,symbol: resolveCardCodeLinks},{kind: function,file: src/ops/link.ts,symbol: validateCodeLinks},{kind: function,file: src/ops/link.ts,symbol: findCardsBySymbol},{kind: class,file: src/db/code-link-repo.ts,symbol: DrizzleCodeLinkRepository}],tags: [contract,code-link],relations: [drift-lifecycle,card-model]}
---
## Contracts
- WHEN code links stored THEN deduplicated by (cardKey, kind, file, symbol) — unique constraint in DB
- WHEN replaceForCard called THEN all existing links for that card are deleted and new set inserted atomically
- WHEN resolveCardCodeLinks called THEN each link is looked up in gildash; unresolved links return symbol=null
- WHEN validateCodeLinks called AND broken links found on active card THEN auto-transitions card to drifted
- WHEN validateCodeLinks called on draft card THEN broken links reported as "planned" (no status change)
- WHEN symbol is deleted from code THEN code link is NOT auto-deleted — marked drifted instead
- WHEN syncSymbolChanges detects rename/move THEN code link is updated; deletions are reported for manual review

## Cross-module contracts
- Code links are the bridge between cards and gildash symbol index — if gildash is unavailable, resolution is skipped but links are still stored
- findCardsBySymbol searches both codeLinks (exact match) and boundary globs (file match) — two different matching strategies
- findAffectedCards is used by preChangeCheck to find cards impacted by file/symbol changes