---
{key: spec/project-analysis,summary: "Behavioral contract for analyze and getOnboardingSummary: health dashboard, coverage, drift report, and glossary stats",status: draft,type: spec,parent: impact-analysis,boundary: [src/ops/analyze.ts],tags: [analysis,health,coverage,onboarding],relations: [spec/drift-detection,glossary-system],codeLinks: [{kind: function,file: src/ops/analyze.ts,symbol: analyze},{kind: function,file: src/ops/analyze.ts,symbol: getOnboardingSummary},{kind: interface,file: src/ops/analyze.ts,symbol: AnalyzeResult},{kind: interface,file: src/ops/analyze.ts,symbol: AnalyzeHealth},{kind: interface,file: src/ops/analyze.ts,symbol: AnalyzeCoverage},{kind: interface,file: src/ops/analyze.ts,symbol: OnboardingSummary}],glossary: [card,drift,glossary,gildash,card-status,boundary]}
---
## Contracts

### C-01: Health computation uses drift detection, not just DB status
- **Given** the full card database
- **When** analyze is called
- **Then** checkDrift runs with autoTransition=false (read-only)
- **And** draft cards are counted from DB directly (checkDrift skips them)
- **And** non-draft cards with detected driftType are counted as drifted regardless of DB status
- **And** non-draft cards with DB status=drifted but no detected drift are still counted as drifted

### C-02: Stale boundary detection
- **Given** cards with boundary patterns
- **When** analyze runs with ctx.projectRoot available
- **Then** each card's boundary globs are scanned against the project root
- **And** cards where no boundary pattern matches any file are counted in staleBoundary

### C-03: Coverage analysis via gildash
- **Given** gildash is configured
- **When** analyze runs
- **Then** getUncoveredSymbols provides totalSymbols, coveredSymbols, and coverageRatio
- **And** unlinked symbols are limited to UNLINKED_SYMBOLS_LIMIT=20 entries
- **And** when gildash is not configured, coverage defaults to {totalSymbols:0, covered:0, ratio:1}

### C-04: Drifted cards pagination
- **Given** the drifted cards list
- **When** offset and limit options are provided
- **Then** driftedCards is sliced by offset and limit
- **And** driftedCardsTotal always reflects the unsliced count

### C-05: Glossary stats
- **Given** the project glossary and card database
- **When** analyze computes glossary stats
- **Then** totalWords is the count of glossary entries
- **And** unusedWords lists glossary words not referenced by any card's glossary field
- **And** the full entries list is included

### C-06: Onboarding summary hierarchy
- **Given** cards in the database
- **When** getOnboardingSummary is called
- **Then** root cards (parent=null) form the top level of the hierarchy tree
- **And** children are recursively added up to HIERARCHY_MAX_DEPTH=3
- **And** card counts by type (intent/spec) and status (draft/active/drifted) are included
- **And** total relation count uses forward relations only (no double-counting)

### C-07: Onboarding drift enrichment
- **Given** drifted cards exist in the database
- **When** getOnboardingSummary runs
- **Then** lightweight drift detection (checkDrift, autoTransition=false) enriches drifted cards with driftType
- **And** if no drifted cards exist, drift detection is skipped entirely

## Failure Modes

| Violation | System Behavior |
|---|---|
| gildash unavailable | Coverage defaults to ratio=1, unlinkedSymbols empty |
| projectRoot not set | staleBoundary=0, no boundary scanning |
| Boundary JSON parse error | Card silently skipped for stale boundary check |
| checkDrift throws | Error propagated (analyze fails) |
| offset > total drifted | Empty driftedCards slice, driftedCardsTotal still correct |