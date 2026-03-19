# Step 5: Plan + Plan Review

## Purpose

Generate an executable plan from all prior data. The plan IS the executor's prompt — no transformation needed. Plan-reviewer attacks until zero issues.

## Agent

`ed-planner`

## Input

- `AnalysisResult` from Step 1
- `ClassifyResult` from Step 2
- Decision files from Step 3 (if any)
- Research artifacts (if any)

## Procedure

<step name="1-generate-plan" priority="first">

Create `PLAN-{workflow-id}.md` with:

1. **Summary** — What this plan achieves, which user decisions it implements
2. **Tasks** — Ordered, each as executor prompt:

```xml
<task id="01" depends="">
  <name>Create JWT token service</name>
  <related_cards>auth-middleware, session-management</related_cards>
  <preserve_ac>AC-1: All APIs require authentication</preserve_ac>
  <modify_ac></modify_ac>
  <files>src/auth/token.ts, src/auth/jwt.ts</files>
  <reuse>hashPassword() from src/utils/crypto.ts (found in Research)</reuse>
  <action>
    Implement JWT issue/verify/refresh using jose library.
    Follow existing middleware chain pattern (src/middleware/index.ts).
  </action>
  <verify>npm run test -- --grep "jwt"</verify>
  <done>Token issue, verify, refresh APIs work. AC-1 still holds.</done>
</task>

<task id="02" depends="01">
  ...
</task>
```

3. **Wave plan** — Group independent tasks for parallel execution:
```
Wave 1: [TASK-01, TASK-03]  (no dependencies)
Wave 2: [TASK-02]           (depends on 01)
Wave 3: [TASK-04]           (depends on 02)
```

</step>

<step name="2-validate-plan">

Self-check before submitting to reviewer:
- Every affected card from analysis has at least one task
- Every AC is either preserved or explicitly modified (Design Change only)
- Every task has a `verify` command
- No dependency cycles
- Each task fits in one context window (~50 files max)
- `reuse` references exist in the codebase

</step>

## Reviewer: plan-reviewer (Ralph Loop)

**Fresh context per iteration.** Planner writes plan to flow directory. Reviewer reads from disk.

**Exit condition: zero issues (machine-verifiable where possible).**

Attacks:
1. All affected cards covered?
2. All relevant ACs mapped to tasks?
3. Dependency graph is acyclic?
4. File scope conflicts between tasks? (Two tasks editing same file in same wave)
5. Every task has a `verify` command?
6. Task size fits context window?
7. Reuse references are real? (Not hallucinated paths)

**On issue found:** Reviewer writes issues to flow directory → planner loads issues in fresh context → revises plan → resubmit. Loop until zero issues.

**Stagnation detection:** Same issue unresolved after 2 consecutive attempts (compared via disk records) → escalate to user with issue details + planner's attempts.

**Contradiction detection:** Reviewer says "split task X" in iteration N, then "merge tasks Y,Z" in N+1 where Y,Z were the split result → escalate to user with both positions.

## Output

`PLAN-{workflow-id}.md` + individual `TASK-{NN}.md` files in `.emberdeck/plans/`.

## Transition

| Classification | Next Step |
|---------------|-----------|
| Bug Fix | Single-task plan (lightweight, no Ralph Loop) → Execute |
| All others | Execute |

## Bug Fix Lightweight Plan

After Test (RED) confirms the bug, planner generates a single task:

```xml
<task id="01" depends="">
  <name>Fix: [violated AC description]</name>
  <related_cards>[affected card]</related_cards>
  <preserve_ac>[other ACs that must not break]</preserve_ac>
  <files>[files identified in analysis as likely fix locations]</files>
  <failing_test>[test file:line from Test RED step]</failing_test>
  <action>Make the failing test pass without breaking other tests.</action>
  <verify>npm run test</verify>
  <done>All tests pass including the new RED test.</done>
</task>
```

No Plan Review Ralph Loop — single pass self-check only. The test itself is the machine-verifiable goal.

## Spec Service Call

During planning, if planner discovers:
- A card has no ACs for a relevant area
- A design decision is needed that wasn't covered in Spec step
- AC wording is ambiguous and needs clarification

Use ed-spec (Mode A) to collect the missing decision from user, then continue planning with the result.

## Failure Cases

| Case | Action |
|------|--------|
| Spec gap discovered during planning | Use ed-spec → collect decision → continue |
| Cannot decompose into context-window-sized tasks | Ask user to narrow scope |
| Circular dependencies detected | Planner restructures; if unsolvable, escalate |
