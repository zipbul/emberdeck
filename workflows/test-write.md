# Step 6: Test (RED) — Bug Fix Only

## Purpose

Write a failing test BEFORE fixing the bug. The test encodes the violated AC as executable verification. Only runs in Bug Fix flow.

## Agent

`ed-test-writer`

## Input

- `AnalysisResult` from Step 1 (which AC is violated, which code violates it)
- `ClassifyResult` from Step 2 (confirmed Bug Fix)

## Procedure

<step name="1-identify-violation">

From analysis, extract:
- Which AC is violated
- Which code path causes the violation
- Expected behavior (from AC) vs actual behavior

</step>

<step name="2-write-failing-test">

Write test that:
- Targets the specific AC violation
- Uses existing test infrastructure (runner, fixtures, patterns from codebase)
- Fails with current code (RED)
- Will pass when the bug is fixed (GREEN)

Run the test to confirm it fails:
```bash
npm run test -- --grep "test name"
```

If test passes → the test is wrong (not testing the actual bug). Rewrite.

</step>

## Reviewer: test-reviewer (Ralph Loop)

**Fresh context per iteration.** Test-writer writes tests to disk. Reviewer reads from disk.

**Exit condition: zero issues (machine-verifiable: test fails with current code, targets correct AC).**

Attacks:
1. Does the test actually verify the violated AC? (Not testing something else)
2. Does the test reproduce the USER's reported problem, not just a hypothetical AC violation?
3. Is the test specific enough? (Won't pass for wrong reasons)
4. Edge cases missed?
5. Test follows codebase conventions?

**On issue found:** Reviewer writes issues to flow directory → test-writer loads issues in fresh context → revises → resubmit. Loop until zero issues.

**Stagnation detection:** Same issue unresolved after 2 consecutive attempts (compared via disk records) → escalate to user.

**Contradiction detection:** Reviewer contradicts previous feedback → escalate to user with both positions.

## Output

Test file(s) committed. Test run results showing RED (failure) stored in state.

## Transition

Always → **Execute** (GREEN — fix the code to make tests pass)

## Failure Cases

| Case | Action |
|------|--------|
| Cannot reproduce the bug in test | Ask user for reproduction steps |
| Test infrastructure broken | Report to user, suggest manual verification |
| Test passes immediately (bug already fixed?) | Re-analyze — maybe not a Bug Fix classification |
