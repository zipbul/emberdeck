---
{key: impact-analysis,summary: "Design document for pre-change impact analysis, regression guard, coverage analysis, and project health reporting",status: draft,type: intent,boundary: [src/ops/impact.ts,src/ops/analyze.ts],tags: [impact,regression,coverage,analysis],glossary: [regression-guard,drift,codeLink,boundary,card,card-status]}
---
## Problem & Goals

**Problem**: Before modifying code, an agent needs to know which design specs will be affected and whether the change is safe to proceed with. Without pre-change analysis, agents make changes blindly, potentially violating multiple specs simultaneously. After changes, there is no automated gate to verify that drift has not exceeded acceptable levels.

**Who has it**: Agents making code modifications in projects with Emberdeck cards. Every code change potentially affects multiple cards through direct code links, boundary matches, and transitive dependencies.

**What breaks without this**: Agents modify code without awareness of affected specs. Regressions accumulate silently. There is no threshold-based gate to block deployments when too many specs have drifted.

**Success looks like**: Before any code change, the agent can assess risk level, see all affected cards (direct, boundary, transitive), and identify uncovered files. After changes, a regression guard provides a pass/fail verdict based on the drifted card ratio among affected cards. A full project analysis dashboard shows health, coverage, and drift status.

## User Scenarios

### P1: Pre-change impact check
- **Given** an agent is about to modify specific files
- **When** preChangeCheck is called with file paths and optional symbol names
- **Then** directly affected cards (via codeLinks) are identified with affected link counts
- **And** boundary-affected cards (via glob pattern matching) are identified
- **And** transitively affected cards are discovered via backward BFS (maxDepth=3)
- **And** uncovered files (not matched by any card's codeLinks or boundaries) are listed
- **And** risk level is calculated: low (0 cards), medium (1-2), high (3-4), critical (5+ or >50% drifted)
- **And** suggested actions are generated for each affected card

### P1: Regression guard
- **Given** files have been changed
- **When** regressionGuard is called with the changed file list
- **Then** affected cards are found via preChangeCheck
- **And** fresh drift detection runs on each affected card (read-only, no auto-transition)
- **And** the drifted ratio (drifted / total affected) is computed
- **And** if driftedRatio > threshold (default 0), the guard returns fail
- **And** if 0 affected cards, the guard returns pass

### P2: Full project analysis
- **Given** a need for project-wide health assessment
- **When** analyze is called
- **Then** health counts are reported: total, active, drifted, draft, brokenLinks, staleBoundary
- **And** coverage is reported: totalSymbols, covered, ratio
- **And** unlinked symbols (up to 20) are listed for spec creation guidance
- **And** drifted cards are listed with their drift types and link health
- **And** glossary stats are included: total words, unused words, full entry list
- **And** results support pagination (offset/limit) for drifted cards

### P2: Onboarding summary
- **Given** a fresh agent context starting a new session
- **When** getOnboardingSummary is called
- **Then** card counts by type (intent/spec) and status (draft/active/drifted) are returned
- **And** a hierarchy tree (roots with up to 3 levels of children) is built
- **And** coverage ratio is included if gildash is available
- **And** drifted cards with their drift types are listed
- **And** total relation count (forward only) is reported

### P3: Check card interactions
- **Given** multiple cards that may share code symbols or files
- **When** checkInteractions is called with card keys
- **Then** shared symbols (same file + same symbol name) are detected between card pairs
- **And** shared files (both cards link to same file) are detected
- **And** import-level dependencies between card file sets are discovered via gildash
- **And** undefined relations (shared code but no declared relation) are flagged

## Requirements

- **FR-001**: preChangeCheck MUST find cards via three methods: direct codeLink match, boundary glob match, and backward BFS transitive discovery.
- **FR-002**: preChangeCheck MUST calculate risk level using thresholds: critical (>=5 affected OR >50% drifted), high (>=3 OR >25% drifted), medium (>=1), low (0).
- **FR-003**: preChangeCheck MUST attach the full project glossary to the result for agent context.
- **FR-004**: regressionGuard MUST run fresh drift detection with autoTransition=false (read-only).
- **FR-005**: regressionGuard MUST return pass when 0 cards are affected, regardless of threshold.
- **FR-006**: regressionGuard MUST use the threshold from ctx.regressionThreshold (default 0).
- **FR-007**: analyze MUST combine checkDrift (autoTransition=false) and getUncoveredSymbols into a single report.
- **FR-008**: analyze MUST limit unlinked symbols to 20 entries (UNLINKED_SYMBOLS_LIMIT).
- **FR-009**: analyze MUST detect stale boundaries (glob patterns matching no files on disk).
- **FR-010**: getOnboardingSummary MUST build hierarchy from root cards (parent=null) up to 3 levels.
- **FR-011**: checkInteractions MUST detect import-level dependencies via gildash.getDependencies when available.

## Success Criteria

- Pre-change check identifies all affected cards (direct + boundary + transitive) within a single call.
- Regression guard produces a deterministic pass/fail based solely on the drifted ratio and threshold.
- Project analysis provides a complete health dashboard in one call, including coverage ratio when gildash is configured.
- Zero false passes: if any card among affected cards is drifted and threshold is 0, the guard fails.

## Scope & Constraints

**Covers**: preChangeCheck, regressionGuard, analyze, getOnboardingSummary, checkInteractions, risk level calculation, coverage analysis.

**Excludes**: Drift detection mechanics (see code-binding intent), card CRUD (see card-lifecycle intent).

**Assumes**: BFS backward traversal uses maxDepth=3. Risk level thresholds are hardcoded (not configurable). regressionThreshold defaults to 0 (strictest mode). gildash may or may not be available.