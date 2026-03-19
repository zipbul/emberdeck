# Step 9: Validate

## Purpose

Confirm that the implementation fulfills design intent — not just that tests pass. Trace actual execution paths through code. **"Tests passing != requirements met."**

## Agent

`ed-validator`

## Input

- All Verify results (from flow directory)
- Plan (TASK files)
- Decision files from Spec step
- AnalysisResult (for affected cards/ACs)

## Procedure

<step name="1-decision-to-code-tracing" priority="first">

For each design decision from Spec step:
1. Find the code location (file:line) that implements this decision
2. Confirm the implementation matches the decision
3. If decision was "JWT with refresh tokens" → find the actual JWT creation code, verify it uses refresh tokens, verify rotation is implemented

**Bad validate:** "createToken function exists in token.ts? Yes. PASS."
**Good validate:** "createToken at token.ts:15 creates JWT with jose.sign(). Refresh token is generated at token.ts:42, stored via saveRefreshToken(). Rotation happens at token.ts:67 where old token is invalidated before new one is issued. PASS."

</step>

<step name="2-execution-path-tracing">

Trace at least one complex execution path end-to-end through actual code:

1. Pick the most critical or complex path (e.g., "expired token → 401 → refresh → retry")
2. Walk through the code, function by function, file by file
3. Verify data flows correctly at each step
4. Note any path where behavior deviates from spec

This is NOT "does the function exist" — it's "does the data flow correctly through the full chain."

</step>

<step name="3-ac-verification">

For each AC in affected cards:
1. Is it satisfied by the implementation?
2. How? (Specific file:line reference)
3. Any AC only partially satisfied?

```
AC-1: "All APIs require authentication"
→ Verified: authMiddleware applied in src/middleware/index.ts:12,
  runs before all route handlers (confirmed in src/routes/index.ts:5-20).
  No unprotected routes found.
```

</step>

<step name="4-completeness-check">

Completeness checks:
1. All workflow steps executed? (Check flow directory state)
2. Full drift recalculation — check drift
3. Full code_link integrity — verify links
4. If plan exists: all tasks marked complete?

</step>

## Validation Depth by Classification

| Classification | Depth |
|---------------|-------|
| Onboarding | Card structure verification (cards cover the codebase) |
| Partial Onboarding | Target area card verification |
| Design Change (drift) | Full consistency (drift → 0) |
| Design Change | Full + execution path tracing |
| Feature Add | Affected scope |
| Bug Fix | Violated AC only |
| Refactoring | All ACs preserved (no behavior change) |

Chore does not enter Validate — goes directly from Verify to Commit.

## Reviewer: validate-reviewer (Ralph Loop)

**Fresh context per iteration.** Validator writes trace results to flow directory. Reviewer reads from disk.

**Exit condition: zero issues (machine-verifiable where possible).**

Checks:
1. Execution path tracing deep enough? (Only happy path, missed error path?)
2. All design decisions confirmed in code?
3. Formal validation disguised as substantive? ("Function exists" ≠ "function works correctly")

**On issue found:** Reviewer writes issues to flow directory → validator loads issues in fresh context → re-traces flagged paths → resubmit.

**Stagnation detection:** Same validation gap unresolved after 2 consecutive attempts (compared via disk records) → escalate to user.

**Contradiction detection:** Reviewer demands deeper tracing on path A in iteration N, then says path A tracing was unnecessary in N+1 → escalate to user with both positions.

## Validate → Execute Cross-Step Loop

If Validate finds code problems (not just shallow tracing):

```
Validate fails (code issue)
  → write structured fix request to flow dir: { task_id, issue, expected, actual, file:line }
  → Execute loads fix request in fresh context → fixes → Verify → Validate
```

**Stagnation detection:** Same fix request unresolved after 2 consecutive Execute attempts → escalate to user.

This is distinct from the within-step Ralph Loop (reviewer attacking validation depth).

## Output

```json
{
  "all_ac_status": [
    {"card": "auth-middleware", "ac": "AC-1", "status": "satisfied", "evidence": "src/middleware/index.ts:12"},
    {"card": "auth-middleware", "ac": "AC-2", "status": "satisfied", "evidence": "src/auth/token.ts:15-67"}
  ],
  "execution_paths_traced": [
    {
      "path": "expired token → 401 → refresh → retry",
      "steps": ["middleware/auth.ts:30", "auth/token.ts:50", "auth/token.ts:67", "routes/api.ts:15"],
      "result": "pass"
    }
  ],
  "design_decisions_confirmed": [
    {"decision": "JWT with refresh tokens", "confirmed": true, "location": "src/auth/token.ts"}
  ],
  "drift_score": 0.00,
  "broken_links": [],
  "manual_verification_needed": [
    {"ac": "AC-3", "reason": "Requires manual curl test", "command": "curl -H 'Authorization: Bearer expired' localhost:3000/api/me"}
  ]
}
```

## Transition

| Classification | Next |
|---------------|------|
| Design Change | Spec (Mode C: Update Cards) |
| Feature Add | Spec (Mode C: add links + optional new ACs) |
| All others | Commit |

## On Validation Failure

| Failure type | Action |
|-------------|--------|
| Code doesn't match design decision | → Fix request → Execute |
| Execution path broken | → Fix request → Execute |
| Plan was wrong (missing task) | → Back to Plan (re-plan) |
| AC unsatisfiable by design | → Escalate to user |
