---
{key: impact-regression,summary: Pre-change impact analysis and regression guard threshold contract,status: active,type: spec,parent: drift-lifecycle,codeLinks: [{kind: function,file: src/ops/impact.ts,symbol: preChangeCheck},{kind: function,file: src/ops/impact.ts,symbol: regressionGuard}],tags: [contract,analysis],relations: [drift-lifecycle,code-link-contract,drift-detection-rules]}
---
## Contracts
### preChangeCheck
- WHEN files provided THEN find affected cards in three tiers:
  1. **direct**: codeLink points to the file/symbol
  2. **boundary**: boundary glob matches the file
  3. **transitive**: backward BFS graph search (maxDepth 3) from direct/boundary cards
- WHEN risk level calculated THEN thresholds are:
  - critical: ≥5 affected OR drifted ratio >50%
  - high: ≥3 affected OR drifted ratio >25%
  - medium: ≥1 affected
  - low: 0 affected
- WHEN file not covered by any card or boundary THEN reported in newUncoveredFiles (respects ignorePatterns)

### regressionGuard
- WHEN 0 affected cards THEN always pass
- WHEN driftedRatio > threshold THEN fail
- WHEN driftedRatio ≤ threshold THEN pass
- WHEN checking drift for regression THEN uses autoTransition=false (read-only, no status change)
- WHEN regressionThreshold not configured THEN default is 0 (any drift = fail)

## Cross-module contracts
- preChangeCheck uses getRelationGraph with direction='backward' for transitive impact — depends on relation-mirroring being correct
- regressionGuard runs fresh checkDrift per affected card, not cached — ensures up-to-date drift status
- regressionThreshold is configured in .emberdeck.jsonc, validated to [0, 1] range