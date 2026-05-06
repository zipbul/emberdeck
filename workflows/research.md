> ⚠️ **Historical workflow design.** Pre-CLI v2 agent-routing prototype using `ed-analyst` etc. Current emberdeck is single-binary CLI; agent should follow `.claude/skills/emberdeck/SKILL.md` instead. Kept for design intent reference.

# Research (Service)

## Purpose

External information gathering. Any agent can invoke this service when they need information that doesn't exist in the codebase or cards.

**This is NOT a workflow step.** It's a service available to all agents.

## Agent

`ed-researcher`

## When to invoke

| Caller | Situation | Example |
|--------|-----------|---------|
| ed-analyst | External context needed for analysis | "What breaking changes are in express 5?" |
| ed-spec | Background needed for user question options | "What are the JWT vs session tradeoffs?" |
| ed-planner | Library docs needed for task design | "How does jose library handle key rotation?" |
| ed-executor | Implementation reference needed | "What's the correct CORS header format?" |
| Orchestrator | Exploration classification — main activity | "How does the auth module work?" |

## Interface

```yaml
query: "specific question or topic"
scope: "external" | "codebase" | "both"
context:
  reason: "Why this information is needed"
```

## Procedure

<step name="1-search">

Based on scope:
- **external**: WebSearch + WebFetch for docs, guides, references
- **codebase**: Read + Grep + Glob for patterns, conventions, existing solutions
- **both**: Combine

</step>

<step name="2-synthesize">

Return structured result to caller:

```yaml
query: "original question"
findings:
  - source: "url or file:line"
    summary: "what was found"
    relevance: "how it applies to the caller's context"
constraints:
  - "any limitations or caveats discovered"
```

</step>

## Artifact Persistence

If findings are substantial (will be referenced by multiple agents later), write to `.emberdeck/research/RESEARCH-{topic}.md`. Otherwise, return inline to caller.

## Exploration Mode

When classification is **Exploration**, Research is the primary activity:

1. Orchestrator triggers research with user's question
2. Researcher investigates (codebase + external as needed)
3. Result goes directly to user as a report
4. **No Plan/Execute/Verify/Validate** — flow ends after report

## No Reviewer

Research results are inputs to other agents' work, which gets reviewed in those agents' own review cycles. No separate research-reviewer needed.

## Failure Cases

| Case | Action |
|------|--------|
| WebSearch returns nothing useful | Report absence to caller, suggest alternative query |
| Codebase search finds nothing | Report absence, caller proceeds without |
| Conflicting information found | Present both sides to caller, let caller decide |
