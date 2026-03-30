---
{key: spec/regression-guard,summary: "Behavioral contract for regressionGuard: threshold-based pass/fail gate using fresh drift detection on affected cards",status: draft,type: spec,parent: impact-analysis,boundary: [src/ops/impact.ts],tags: [regression,gate,threshold],relations: [spec/drift-detection,spec/pre-change-check],codeLinks: [{kind: function,file: src/ops/impact.ts,symbol: regressionGuard},{kind: interface,file: src/ops/impact.ts,symbol: RegressionResult}],glossary: [regression-guard,drift,card,card-status]}
---
## Contracts

### C-01: Zero affected cards always pass
- **Given** changed files that affect no cards
- **When** regressionGuard is called
- **Then** result MUST be passOrFail='pass' with driftedRatio=0 and empty affectedCards

### C-02: Fresh drift detection (read-only)
- **Given** affected cards found via preChangeCheck
- **When** drift status is evaluated
- **Then** checkDrift MUST be called with maxDepth=0 and autoTransition=false for each affected card
- **And** this ensures no side effects (no auto-transition, no file writes)
- **And** the detected driftType is included in the result

### C-03: Threshold comparison
- **Given** the drifted ratio (driftedCount / totalAffected)
- **When** compared against ctx.regressionThreshold (default 0)
- **Then** if driftedRatio > threshold, result is fail
- **And** if driftedRatio <= threshold, result is pass
- **And** with default threshold=0, any single drifted card causes failure

### C-04: Result structure
- **Given** the guard completes
- **When** the result is returned
- **Then** it MUST include: passOrFail, driftedRatio, affectedCards (with key, status, optional driftType), and threshold

### C-05: Drift status aggregation
- **Given** affected cards
- **When** counting drifted cards
- **Then** a card counts as drifted if checkDrift detects a driftType OR its DB status is 'drifted'
- **And** draft cards from preChangeCheck are still included in the affected count

## Failure Modes

| Violation | System Behavior |
|---|---|
| 0 affected cards | pass returned regardless of threshold |
| All affected cards drifted, threshold=0 | fail with driftedRatio=1.0 |
| checkDrift throws for a card | Card status falls back to DB status |
| threshold=1.0 | Always pass (ratio can never exceed 1.0) |