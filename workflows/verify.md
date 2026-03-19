# Step 8: Verify

## Purpose

Mechanical, deterministic checks after each task execution. Binary pass/fail — no judgment involved.

## Agent

`ed-verifier`

## Input

- Changed files (from git diff)
- Task's `verify` command
- `AnalysisResult` for baseline comparison

## Procedure

<step name="1-run-checks" priority="first">

Execute in order (stop on first failure category):

1. **Task verify command** — Run the task's `verify` field
   ```bash
   npm run test -- --grep "jwt"
   ```

2. **Full test suite** — Run all tests to catch regressions
   ```bash
   npm run test
   ```

3. **Type check** — If TypeScript project
   ```bash
   npm run typecheck  # or tsc --noEmit
   ```

4. **Lint** — If lint configured
   ```bash
   npm run lint
   ```

</step>

<step name="2-structural-checks">

Deterministic checks (no LLM judgment):

5. **Symbol re-extraction** — find symbols in changed files
   - Compare with pre-change symbols
   - Detect removed/renamed exports that others depend on

6. **Code link integrity** — verify links
   - All code_links in affected cards still resolve

7. **Drift recalculation** — check drift
   - Drift should decrease or stay same, not increase

</step>

## No Reviewer

Verify is fully mechanical. No LLM judgment = no reviewer needed. The results are deterministic.

## Output

```json
{
  "task_id": "01",
  "tests_passed": true,
  "test_count": {"passed": 42, "failed": 0, "skipped": 2},
  "typecheck_passed": true,
  "lint_passed": true,
  "broken_links": [],
  "drift_score": 0.02,
  "drift_delta": -0.05,
  "symbols_changed": {
    "added": ["createToken", "verifyToken"],
    "removed": [],
    "renamed": []
  },
  "pass": true
}
```

## Transition

| Result | Next |
|--------|------|
| All pass | Back to Execute (next task) or → Validate (if last task) |
| Any fail | Back to Execute (same task, fix and retry — Ralph Loop) |

## Failure Cases

| Case | Action |
|------|--------|
| Test runner not configured | Warn, skip test step, continue with other checks |
| Typecheck not available | Skip, continue |
| Tool error | Retry once, then report |
| Tests pass but drift increased | Flag as warning (not blocking), proceed |
