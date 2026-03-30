---
{key: spec/pre-change-check,summary: "Behavioral contract for preChangeCheck: direct/boundary/transitive card discovery, risk level calculation, and suggested actions",status: draft,type: spec,parent: impact-analysis,boundary: [src/ops/impact.ts],tags: [impact,risk,pre-change],relations: [code-binding,structural-integrity],codeLinks: [{kind: function,file: src/ops/impact.ts,symbol: preChangeCheck},{kind: interface,file: src/ops/impact.ts,symbol: PreChangeResult},{kind: interface,file: src/ops/impact.ts,symbol: AffectedCard},{kind: type,file: src/ops/impact.ts,symbol: RiskLevel}],glossary: [codeLink,boundary,relation,drift,card,glossary]}
---
## Contracts

### C-01: Three-method card discovery
- **Given** a list of file paths and optional symbol names
- **When** preChangeCheck is called
- **Then** direct matches: cards whose codeLinks reference the given files (filtered by symbol if provided) are found with affected link counts
- **And** boundary matches: cards whose boundary glob patterns match the given files (excluding already-direct cards) are found
- **And** transitive matches: backward BFS (maxDepth=3) from direct+boundary cards discovers transitively dependent cards

### C-02: Risk level calculation
- **Given** the set of affected cards
- **When** risk level is computed
- **Then** critical: totalAffected >= 5 OR driftedRatio > 0.5
- **And** high: totalAffected >= 3 OR driftedRatio > 0.25
- **And** medium: totalAffected >= 1
- **And** low: totalAffected == 0
- **And** driftedRatio is driftedCount / totalAffected (driftedCount from DB status)

### C-03: Uncovered file detection
- **Given** the input file list
- **When** coverage is checked against all cards' codeLinks and boundaries
- **Then** files not covered by any card's codeLinks or boundary patterns are listed as newUncoveredFiles
- **And** files matching ctx.ignorePatterns are excluded from the uncovered list

### C-04: Suggested actions generation
- **Given** affected cards categorized by linkType
- **When** suggested actions are built
- **Then** direct cards get "Review card X -- N code link(s) affected"
- **And** boundary cards get "Review card X -- file is within its boundary scope"
- **And** transitive cards get "Check transitive dependency: X (via Y)"
- **And** uncovered files get "N file(s) not covered by any card -- consider creating specs"

### C-05: Link status computation
- **Given** an affected card and gildash availability
- **When** computeLinkStatus runs
- **Then** each codeLink is resolved via gildash.searchSymbols (exact match)
- **And** result contains valid and broken counts
- **And** when gildash is unavailable, linkStatus is undefined

### C-06: Glossary attachment
- **Given** a project with glossary entries
- **When** preChangeCheck completes
- **Then** the full glossary (all entries) MUST be attached to the result for agent context

## Failure Modes

| Violation | System Behavior |
|---|---|
| No affected cards found | riskLevel=low, empty affectedCards, no suggestedActions |
| gildash unavailable | linkStatus omitted from affected cards; drift ratio uses DB status only |
| Boundary JSON parse failure | Card silently skipped for boundary matching |
| Relation target not in DB | Transitive discovery skips non-existent nodes |