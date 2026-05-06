> ⚠️ **Historical workflow design.** Pre-CLI v2 agent-routing prototype using `ed-analyst` etc. Current emberdeck is single-binary CLI; agent should follow `.claude/skills/emberdeck/SKILL.md` instead. Kept for design intent reference.

# Step 3: Spec

## Purpose

Design knowledge specialist. Creates cards, collects design decisions, updates cards after code changes. Other agents invoke this agent as a service when they need spec expertise.

## Agent

`ed-spec`

## Modes

ed-spec operates in three modes depending on who invokes it and why:

### Mode A: Question — Collect design decisions from user

**Invoked by:** Orchestrator (after Classify)

Collects decisions that only a human can make. Does not ask what machines can determine.

<step name="A1-determine-questions">

Based on classification depth:

| Classification | Question depth |
|---------------|---------------|
| Onboarding | Many — scope, boundaries, contracts for each area |
| Partial Onboarding | Target area contracts only |
| Drift (cards outdated) | AC re-confirmation — handled as Design Change |
| Design Change | Many — scope, new ACs, migration strategy |
| Feature Add | 2-4 questions |
| Refactoring | 0-1 questions |
| Bug Fix / Chore / Exploration | Skip this mode |

**Do not ask:**
- What files are affected (tools can determine this)
- What the current code does (read it)
- What patterns exist (Research step handles this)
- Anything the LLM can reasonably decide

**Do ask:**
- Choice between implementation approaches (with code-contextualized options)
- Scope of design change
- New AC definitions
- Whether existing ACs should change

</step>

<step name="A2-ask">

For each question:

```
AskUserQuestion(
  question: "[Concrete question with code context]"
  options: [
    "Option A — [description with existing code reference]",
    "Option B — [description]",
    "I'll explain"
  ]
)
```

Rules:
- **Concrete examples, never abstract** — "3-second timeout" not "good UX"
- **Code context in options** — "Reuse existing hashPassword() util" not "Use existing code"
- **Freeform escape hatch** — Always include "I'll explain" option
- **Downstream awareness** — State who consumes this answer ("This decides whether Plan includes a migration task")
- **No checklist dumping** — Ask one decision at a time, build on previous answers

</step>

<step name="A3-persist">

Each answer → `.emberdeck/decisions/DECISION-{N}.md`:

```yaml
---
area: auth
decision: Use JWT with refresh tokens
rationale: User chose JWT over session cookies for stateless scaling
ac_changes:
  - card: auth-middleware
    ac: AC-2
    from: "Session-based authentication"
    to: "JWT-based authentication with refresh tokens"
downstream: plan
---

User selected JWT with refresh tokens. Refresh token rotation
will be required. Access token TTL: 15 minutes (user confirmed).
```

</step>

### Mode B: Create Cards — Onboarding

**Invoked by:** Orchestrator (after Question mode, during Onboarding/Partial Onboarding)

Creates design cards from scratch based on codebase analysis and user decisions.

<step name="B1-structure">

From analysis + user decisions, determine card structure:
1. Which areas of the codebase need cards
2. Parent-child relationships between cards
3. ACs per card (from user decisions + code analysis)
4. Code links (from symbol extraction)

</step>

<step name="B2-create">

Write card files to `.emberdeck/cards/`:
- Proper parent relationships
- ACs that describe current behavior (not aspirational)
- Code links to actual symbols
- Status: "implemented" (describing what exists)

</step>

<step name="B3-verify">

Run checks:
- Verify links — all code_links resolve
- Check coverage — coverage meets target
- Check drift — drift should be ~0 (cards describe current code)

</step>

### Mode C: Update Cards — Post-validation

**Invoked by:** Host agent (after Validate, for Design Change and Feature Add) or Planner (when plan reveals spec gaps)

Updates existing cards to reflect code changes or fills spec gaps discovered during planning.

**Design Change:** Full card update — AC text changes, code_link updates, status updates, new cards.
**Feature Add:** Lightweight update — add new code_links for new symbols, optionally add new ACs for new behavior. Does NOT modify existing ACs (that would be a Design Change).

<step name="C1-identify-changes">

From Validate results and Decision files, determine:
1. Which cards need AC updates
2. Which cards need new code_links (new symbols created)
3. Which cards need status changes
4. Whether new cards are needed (new component/module created)

</step>

<step name="C2-update">

For each affected card:

1. **AC updates** — Change AC text to match new implementation
2. **Code link updates** — Add/remove/update symbol links
3. **Status updates** — Update card status if needed
4. **New cards** — If new module/component was created, create card with proper parent, ACs, and code links

</step>

<step name="C3-consistency">

After all updates, run:
- Verify links — all code_links resolve
- Check drift — drift should be 0 or near-0
- Check coverage — coverage should not decrease

</step>

## Spec Skip Condition

If the Plan step already contains:
- Design decisions with rationale
- Implementation TODOs
- Affected files with scope
- Test plan

Then Mode A is skipped. Evaluated by orchestrator before entering this step.

## AC-less Spec Handling

If any affected card has **no ACs defined** → Mode A must collect AC definitions from user before proceeding. Cannot execute/verify without ACs.

## Reviewer: spec-reviewer

Same reviewer for all three modes. Checks:

**Mode A (Question):**
1. Missing critical design decision?
2. Unnecessary questions asked? (Could have been determined mechanically)
3. Ambiguous answers passed through?
4. Scope creep?

**Mode B (Create Cards):**
1. Card structure covers the codebase?
2. ACs describe actual behavior, not aspirational?
3. Code links all resolve?
4. Parent relationships make sense?

**Mode C (Update Cards):**
1. Card updates match actual code changes?
2. ACs accurately describe current implementation?
3. Any affected card missed?
4. New cards needed but not created?

Ralph Loop: **Yes for Mode B and C. Fresh context per iteration.** Spec agent writes cards/updates to disk. Reviewer reads from disk.

**Exit condition: zero issues (machine-verifiable: code_links resolve, drift ~0, coverage maintained).**

Mode A is single pass (follow-up questions go to user, not loop).

**Stagnation detection:** Same issue unresolved after 2 consecutive attempts (compared via disk records) → escalate to user.

**Contradiction detection:** Reviewer contradicts previous feedback → escalate to user with both positions.

## Service Interface

Any agent can use ed-spec when they need spec expertise:

```yaml
mode: A | B | C
context:
  # mode-specific input
reason: "Plan reveals auth card has no AC for token expiry"
```

Response is the spec artifact (decision file or updated card).

## Output

| Mode | Output |
|------|--------|
| A (Question) | Decision files in `.emberdeck/decisions/` |
| B (Create) | New card files in `.emberdeck/cards/` |
| C (Update) | Updated card files in `.emberdeck/cards/` |

## Transition

| Context | Next Step |
|---------|-----------|
| Mode A → Onboarding | Mode B (Create Cards), then Plan |
| Mode A → Design Change | Plan |
| Mode A → Feature Add | Plan |
| Mode A → Refactoring | Plan |
| Mode A → Design Change (drift) | Plan |
| Mode B (after card creation) | Plan |
| Mode C (after Validate, Design Change) | Commit |
| Mode C (after Validate, Feature Add) | Commit |
| Service call from Planner | Returns to Planner |

## Failure Cases

| Case | Action |
|------|--------|
| User gives ambiguous answer | Re-ask with more concrete options |
| User says "you decide" | Make the decision, document rationale, note it was agent-decided |
| Too many questions (>6) | Batch remaining into summary with defaults, ask user to confirm or override |
| Card schema validation fails | Fix card format, retry |
| Cannot determine correct AC wording | Use implementation description as AC, flag for human review |
| New card needed but parent unclear | Ask user which card should be parent |
