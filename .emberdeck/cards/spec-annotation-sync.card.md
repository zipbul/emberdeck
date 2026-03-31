---
{key: spec-annotation-sync,summary: "Spec annotation reconciler: 4-step scan/build/remove/add to keep @spec JSDoc tags synchronized",status: draft,type: spec,parent: code-binding,boundary: [src/ops/spec-sync.ts],codeLinks: [{kind: function,file: src/ops/spec-sync.ts,symbol: writeSpecAnnotations},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSpecAnnotations}],glossary: [codeLink,gildash,card],relations: [code-binding]}
---

## Contracts
- WHEN writeSpecAnnotations is called, THEN it MUST execute 4 steps: (1) SCAN actual @spec annotations from source via gildash, (2) BUILD desired set from DB codeLinks, (3) REMOVE orphan @spec (in actual but not desired), (4) ADD missing @spec (in desired but not actual).
- WHEN a cardKey is provided, THEN only that card's codeLinks are in the desired set and only that card's orphans are removed.
- WHEN removing an orphan @spec leaves a JSDoc block empty, THEN the entire JSDoc block MUST be removed.
- WHEN adding @spec to a symbol with an existing JSDoc block, THEN the tag MUST be inserted before the closing */. When no JSDoc exists, a new single-line or multi-line JSDoc MUST be created.
- WHEN syncSpecAnnotations is called, THEN @spec annotations in source MUST be auto-linked to matching cards. Annotations without matching card keys MUST be reported as unmatched.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Gildash not configured | GildashNotConfiguredError |
| Symbol not found in gildash | symbolNotFound counter incremented, no annotation |
| Source file unreadable | Skipped silently |
| Orphan @spec in empty JSDoc | Entire JSDoc block removed |
