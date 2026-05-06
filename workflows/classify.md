> ⚠️ **Historical workflow design.** Pre-CLI v2 agent-routing prototype using `ed-analyst` etc. Current emberdeck is single-binary CLI; agent should follow `.claude/skills/emberdeck/SKILL.md` instead. Kept for design intent reference.

# Step 2: Classify

## Purpose

Single entry point for all user intents. Determines prerequisites, classifies work type, routes to correct flow. **All intents pass through here — onboarding, exploration, everything.**

## Input

`AnalysisResult` from Step 1.

## Procedure

<step name="1-prerequisites" priority="first">

Check system state before classifying intent:

| Condition | Action |
|-----------|--------|
| `emberdeck_initialized == false` | Inform user → route to Spec(B) for card creation first |
| `coverage.ratio < 0.3` for affected area | Inform user → route to Spec(B) for partial card creation first |
| `drift_score > threshold` | Inform user, ask: "Drift detected. Resolve first or proceed?" |
| Affected cards have no ACs | Note for Spec step — AC collection required before execution |

Prerequisites are resolved before intent classification. After resolution, re-run Analyze and continue.

</step>

<step name="2-classify-intent">

Determine work type based on **signal source that fits the intent**:

| Signal | Look at first | Then check | Classification |
|--------|--------------|------------|---------------|
| "this is broken / doesn't work" | Code + tests — reproduce the problem | Affected cards/ACs | **Bug Fix** |
| "add X / build Y" | Cards/ACs — scope and boundaries | Code — implementation location | **Feature Add** |
| "change X to Y / switch to Z" | Cards/ACs — which ACs must change | Code — impact trace | **Design Change** |
| "clean up / restructure / refactor" | Code structure | ACs — confirm no behavior change | **Refactoring** |
| "update deps / fix CI / lint config" | Code — confirm no card impact | Cards — verify no AC affected | **Chore** |
| "explain / how does X work / what is Y" | Code | — | **Exploration** |
| Multiple intents in one request | Separate each, classify individually | — | **Composite** |
| None of the above | — | — | **No Match** → report to user |

**Ambiguous intent** (e.g., "make it faster"): Ask user a targeted question to disambiguate before classifying.

```
AskUserQuestion(
  question: "How do you want to improve performance?"
  options: [
    "Add caching layer (new component) → Feature Add",
    "Switch algorithm (changes design) → Design Change",
    "Optimize internal code (same behavior) → Refactoring",
    "I'll explain"
  ]
)
```

</step>

<step name="3-human-approval">

Present classification with rationale:

```
AskUserQuestion(
  question: "[Classification]: [1-sentence reason referencing specific card/AC/code]. Proceed?"
  options: [
    "Yes — proceed as [classification]",
    "No — it's actually [alternative]",
    "Let me explain"
  ]
)
```

**Do not proceed without explicit approval.**

If user picks alternative → accept override.
If user picks "Let me explain" → capture input, re-classify.

</step>

<step name="4-branch-and-init">

After approval:
1. Create feature branch from current HEAD: `ed/{classification}/{short-description}`
2. Create task flow directory: `.emberdeck/flows/{workflow-id}/`
3. Write initial state to `.emberdeck/flows/{workflow-id}/state.json`
4. All subsequent work happens on this branch

</step>

## Reviewer: classify-reviewer

Runs after classification, before human approval. Single pass.

Checks:
1. Classification correct? (e.g., labeled "Refactoring" but external behavior changes)
2. Missed composite? (Feature Add + Design Change simultaneously)
3. Prerequisite missed? (Area needs card coverage but wasn't flagged)
4. Drift detected but cause misjudged?
5. Labeled "Chore" but actually affects design?

## Output

```json
{
  "type": "feature-add",
  "rationale": "New notification module within existing card scope, ACs unchanged",
  "approved": true,
  "branch": "ed/feature-add/notification",
  "flow_dir": ".emberdeck/flows/wf-20260320-001/"
}
```

## Transition

| Classification | Next Step |
|----------------|-----------|
| Bug Fix | Test (RED) → Plan (single-task) → Execute → Verify → Validate → Commit |
| Feature Add | Spec(A) → Plan → Execute → Verify → Validate → Spec(C: links+ACs) → Commit |
| Design Change | Spec(A) → Plan → Execute → Verify → Validate → Spec(C) → Commit |
| Refactoring | Plan → Execute → Verify → Validate → Commit |
| Chore | Execute → Verify → Commit |
| Exploration | Research(service) → Report → End |
| Onboarding | Spec(A) → Spec(B) → Validate(card structure) → Commit |
| Partial Onboarding | Spec(A) → Spec(B: scoped) → Validate(card structure) → Commit |
| Composite | Split → order → run sequentially (see below) |
| No Match | Report to user → End |

## Composite Handling

When multiple intents are detected in one request:

<step name="composite-split">

1. **Identify** each distinct intent
2. **Order** by dependency, then by weight if no dependency:
   ```
   Design Change > Bug Fix > Feature Add > Refactoring > Chore
   ```
   Dependency overrides weight — if Feature Add depends on Bug Fix being done first, Bug Fix goes first regardless of weight.

3. **Present** split to user for approval:
   ```
   AskUserQuestion(
     question: "This request contains 2 tasks. Proposed order: 1) Bug Fix (login failure) 2) Feature Add (notifications). OK?"
     options: ["Yes", "Change order", "Handle as single task"]
   )
   ```

4. **Execute sequentially**, each as independent workflow:
   - Each gets its own flow directory (wf-001, wf-002, ...)
   - Same feature branch
   - **Re-analyze between workflows** — prior workflow changed the codebase
   - Each workflow goes through full Classify → ... → Commit cycle

5. **Limit**: If more than 3 sub-workflows, ask user to break into separate requests

</step>

## Failure Cases

| Case | Action |
|------|--------|
| User rejects classification 3+ times | Ask user to describe the work type in their own words |
| Composite cannot be cleanly split | Merge to the heavier classification |
| Ambiguous even after question | Present top 2 options with tradeoffs, let user pick |
| Composite sub-workflow fails midway | Complete what's done, report failure, ask user how to proceed with remaining |
