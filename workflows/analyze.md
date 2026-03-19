# Step 1: Analyze

## Purpose

Gather structured facts about the current state of the codebase and cards before any decision is made. No interpretation, no classification — just data collection.

## Agent

`ed-analyst`

## Input

```yaml
user_intent: string  # raw user message
```

## Procedure

<step name="1-gather" priority="first">

Run the following. All outputs are deterministic JSON — do not parse files manually.

1. **Symbol search** — find symbols on files mentioned or implied by user intent
2. **Card lookup** — find affected cards for each identified file
3. **Impact graph** — get impact graph for each affected card (BFS maxDepth 3)
4. **Code link check** — verify links on affected cards
5. **Drift score** — check drift on affected cards
6. **Coverage** — get coverage for affected area

If user intent is vague (e.g., "fix auth"), expand search:
- Grep for related keywords in file names and symbols
- Include files that import/export from matched files (1-hop)

</step>

<step name="2-structure">

Assemble results into `AnalysisResult`:

```json
{
  "intent": "user's original message",
  "affected_files": ["src/auth/token.ts", ...],
  "symbols": [{"file": "...", "name": "...", "type": "function|class|..."}],
  "cards": [{"key": "auth-middleware", "status": "...", "ac_count": 4}],
  "ac": [{"card": "...", "id": "AC-1", "text": "...", "verifiable": "auto|manual"}],
  "impact_graph": {"nodes": [...], "edges": [...]},
  "broken_links": [],
  "drift_score": 0.0,
  "coverage": {"covered": 12, "total": 15, "ratio": 0.8},
  "card_exists": true,
  "emberdeck_initialized": true
}
```

</step>

## Reviewer: analysis-reviewer

**Ralph Loop: No.** Analysis is primarily mechanical. Reviewer runs once as a sanity check, not a loop.

The analysis-reviewer checks:
1. Are there files in the import chain that were missed? (1-hop check)
2. Are there cards that should be linked but aren't?
3. Is the drift score consistent with the actual file changes?

If reviewer finds issues → analyst re-runs the missed queries and appends to result. Single retry only.

## Output

`AnalysisResult` JSON written to `.emberdeck/state.json` under `analysis` key.

## Transition

Always → **Classify**

## Failure Cases

| Case | Action |
|------|--------|
| No `.emberdeck/` directory | Set `emberdeck_initialized: false`, continue — Classify will route to Onboarding |
| No cards found | Set `card_exists: false`, `coverage.ratio: 0`, continue |
| Tool error | Retry once. If still fails, report to user with error message |
| User intent unparseable | Set `affected_files: []`, continue — Classify will ask user to clarify |
