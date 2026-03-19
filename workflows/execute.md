# Step 7: Execute

## Purpose

Modify code according to the plan. Each task runs in a fresh context window. Atomic commits per task. All work happens on the feature branch created in Classify.

## Agent

`ed-executor`

## Input

- `TASK-{NN}.md` files from Plan step
- Research artifacts (if any)
- Decision files (available for reference)

## Procedure

<step name="1-wave-execution" priority="first">

For each wave in the plan:

1. Spawn sub-agents for each task in the wave (parallel within wave)
2. Each sub-agent:
   a. Load `TASK-{NN}.md` as primary prompt
   b. Read `related_cards` and `preserve_ac` for context
   c. Implement the `action`
   d. Run `verify` command
   e. If verify passes → atomic git commit on feature branch with message referencing task ID
   f. If verify fails → fix and retry (within Execute-Verify loop)
3. Wait for all tasks in wave to complete
4. Proceed to next wave

</step>

<step name="2-deviation-rules">

During execution, unexpected situations arise. Rules:

| Situation | Action |
|-----------|--------|
| Minor bug found in adjacent code | Fix it, note in commit message |
| Missing import/type error | Fix automatically |
| Security/validation gap discovered | Fix automatically |
| Broken import from planned changes | Fix automatically |
| New DB table needed | **STOP** — escalate to user (architecture change) |
| Library replacement needed | **STOP** — escalate to user |
| AC needs to change | **STOP** — this is a design change, not executor's job |
| Scope larger than estimated | **STOP** — report to user with details |

</step>

<step name="3-guards">

**Analysis paralysis guard:** If executor has run 5+ consecutive Read/Grep operations without any Write/Edit → force stop. Report what's blocking to orchestrator.

**Checkpoint gate:** Tasks marked `checkpoint: human-verify` pause for user confirmation before proceeding to next wave.

</step>

## Chore Flow (Direct Execute)

For Chore classification, there is no plan. Executor receives:
- User intent directly
- Analysis result for context
- Runs the changes, commits, moves to Verify

## Bug Fix Flow (GREEN)

For Bug Fix, executor receives:
- Single-task plan from Plan step (lightweight, generated after Test RED)
- Failing test from Test step
- Goal: make the test pass (GREEN) without breaking other tests

## Reviewer: execution-reviewer

Runs **after** each task completes (after Verify pass), not during.

Checks:
1. Code matches plan? (No unauthorized changes)
2. ACs formally satisfied AND substantively satisfied?
3. Code quality acceptable?
4. Incomplete implementation? (TODO comments, stub functions)

If issues found → executor fixes in same task context.

## Output

- Git commits on feature branch (one per task)
- `SUMMARY-{task-id}.md` per task in flow directory:
```yaml
---
task_id: "01"
files_changed: ["src/auth/token.ts", "src/auth/jwt.ts"]
commits: ["abc1234"]
ac_status:
  - card: auth-middleware
    ac: AC-1
    status: preserved
  - card: auth-middleware
    ac: AC-2
    status: modified
---
```

## Execute-Verify Ralph Loop

**Fresh context per iteration.** Progress persists on disk (git commits, task summaries).

```
Execute task → Verify → fail?
  → write failure details to flow dir
  → fresh context: load task + failure details → fix → Verify → fail?
  → ...
```

**Exit condition:** All Verify checks green (machine-verifiable).

**Stagnation detection:** Same test/check failing after 2 consecutive fix attempts (compared via disk records) → escalate to user with error details + attempted fixes.

**Contradiction detection:** Fix for issue A breaks previously passing check B, fixing B re-breaks A → escalate to user (likely a design-level conflict).

## Transition

| Classification | After Execute + Verify |
|----------------|----------------------|
| Chore | Commit (skip Validate) |
| All others | Validate |

## Failure Cases

| Case | Action |
|------|--------|
| Task cannot be completed | Report to user with specific blocker |
| Stagnation in Execute-Verify loop | Escalate partial results to user |
| Git conflict between parallel tasks | Serialize conflicting tasks, retry sequentially |
| Sub-agent crashes | Reload task file from disk, retry with fresh context |
