# GSD Deep Dive: Implementation-Level Analysis

Research date: 2026-03-19
Sources: GitHub repos (gsd-build/get-shit-done, gsd-build/gsd-2), DeepWiki, codecentric.de, dev.to, typevar.dev, ccforeveryone.com

---

## 1. What GSD Actually Is

GSD (Get Shit Done) is a **meta-prompting and context engineering system** that installs as slash commands into Claude Code (and 5 other runtimes). It is NOT a library, NOT a framework you import. It is a set of markdown files that become slash commands, agent definitions, workflow scripts, templates, and a Node.js CLI utility.

The npm package `get-shit-done-cc` contains:

```
commands/gsd/           # 46 slash command definitions (.md)
agents/                 # 16 agent identity files (.md)
get-shit-done/
  bin/gsd-tools.cjs     # Node.js CLI for deterministic operations
  workflows/            # 48 workflow files (.md)
  references/           # 14 reference docs (.md)
  templates/            # 30+ template files (.md, .json)
hooks/                  # PostToolUse and SessionStart hooks
bin/install.js          # Installer/transformer
```

When you run `npx get-shit-done-cc@latest`, the installer copies these files into `~/.claude/` (global) or `.claude/` (local), making them available as `/gsd:*` slash commands.

---

## 2. The Exact User Experience

### 2.1 Installation

```bash
# Interactive (asks which runtime, global vs local)
npx get-shit-done-cc@latest

# Non-interactive
npx get-shit-done-cc --claude --global
```

Terminal output:
```
Get Shit Done v1.0.1
  ✓ Installed commands/gsd
  ✓ Installed get-shit-done
Done! Run /gsd:help to get started.
```

Files land in `~/.claude/commands/gsd/` and `~/.claude/get-shit-done/`.

### 2.2 Starting a New Project

User types in Claude Code:
```
/gsd:new-project
```

What happens internally:
1. Claude loads `commands/gsd/new-project.md`
2. The `<execution_context>` section causes Claude to load the workflow file and references via `@` references
3. The workflow calls `gsd-tools.cjs init new-project` to get JSON state
4. Claude begins the **questioning phase** using `AskUserQuestion()`

### 2.3 The Questioning Flow (new-project)

GSD uses `AskUserQuestion()` -- a Claude Code tool that presents structured choices to the user. The flow is NOT a form. It is a conversation guided by the `questioning.md` reference file.

**Philosophy from the actual code:**
> "Project initialization is dream extraction, not requirements gathering. You're helping the user discover and articulate what they want to build. This isn't a contract negotiation -- it's collaborative thinking."

**Step 1: Open-ended dump.** Claude asks "What do you want to build?" and lets the user explain freely. No structure imposed.

**Step 2: Follow energy.** Whatever the user emphasized, Claude digs into that. "What excited them? What problem sparked this?"

**Step 3: Challenge vagueness.** The actual instruction says:
> "Never accept fuzzy answers. 'Good' means what? 'Users' means who? 'Simple' means how?"

**Step 4: Concrete examples.** "Walk me through using this." "What does that actually look like?"

**AskUserQuestion format:**
```
AskUserQuestion(
  header: "Fast"           // max 12 chars
  question: "Fast how?"
  options: [
    "Sub-second response",
    "Handles large datasets",
    "Quick to build",
    "Let me explain"
  ]
)
```

The tool automatically adds an "Other" option. If user picks "Other" and writes freeform text, Claude is instructed to STOP using AskUserQuestion and switch to plain text conversation until the freeform input is processed.

**Decision gate:** When Claude has enough clarity, it offers:
```
AskUserQuestion(
  header: "Ready?"
  question: "I think I understand what you're after. Ready to create PROJECT.md?"
  options: [
    "Create PROJECT.md",
    "Keep exploring"
  ]
)
```

If "Keep exploring" -- loop continues. If "Create PROJECT.md" -- Claude spawns research agents.

**Anti-patterns explicitly forbidden:**
- Checklist walking (going through domains regardless of what they said)
- Corporate speak ("What are your success criteria?")
- Interrogation (firing questions without building on answers)
- Premature constraints (asking about tech stack before understanding the idea)
- NEVER asking about user's technical experience

### 2.4 Research Phase (inside new-project)

After questioning, Claude spawns **4 parallel research agents** using the `Task()` tool:

```
Task(
  subagent_type: "gsd-project-researcher",
  prompt: "Research [domain]...",
  model: [from config]
)
```

Each researcher writes to `.planning/research/`:
- `STACK.md` -- technology investigation
- `FEATURES.md` -- feature patterns in the domain
- `ARCHITECTURE.md` -- architectural patterns
- `PITFALLS.md` -- common mistakes and risks

Then a `gsd-research-synthesizer` agent combines findings.

### 2.5 Requirements and Roadmap

After research, Claude spawns `gsd-roadmapper` which:
1. Reads PROJECT.md + research artifacts
2. Creates REQUIREMENTS.md with REQ-IDs mapped to v1/v2/out-of-scope
3. Creates ROADMAP.md with phase definitions and success criteria
4. Creates STATE.md for progress tracking

**Artifacts created by new-project:**
```
.planning/
  PROJECT.md
  REQUIREMENTS.md
  ROADMAP.md
  STATE.md
  config.json
  research/
    STACK.md
    FEATURES.md
    ARCHITECTURE.md
    PITFALLS.md
```

Claude tells the user: "Run `/gsd:plan-phase 1` to start execution."

---

## 3. How the Discuss Phase Forces User Input

The discuss phase (`/gsd:discuss-phase N`) is the most sophisticated questioning system in GSD. It spawns NO agents -- the orchestrator directly interacts with the user.

### 3.1 Philosophy

From the actual workflow code:

```xml
<philosophy>
User = founder/visionary. Claude = builder.

The user knows:
- How they imagine it working
- What it should look/feel like
- What's essential vs nice-to-have
- Specific behaviors or references they have in mind

The user doesn't know (and shouldn't be asked):
- Codebase patterns (researcher reads the code)
- Technical risks (researcher identifies these)
- Implementation approach (planner figures this out)
- Success metrics (inferred from the work)
</philosophy>
```

### 3.2 The 9-Step Process

**Step 1: Initialize.** Validates phase number exists in roadmap. Runs `gsd-tools init phase-op`.

**Step 2: Check existing.** If CONTEXT.md already exists, offers: "Update it" / "View it" / "Skip".

**Step 3: Load prior context.** Reads PROJECT.md, REQUIREMENTS.md, STATE.md, and ALL prior CONTEXT.md files. Builds an internal `<prior_decisions>` context to avoid re-asking decided questions.

**Step 4: Cross-reference todos.** Checks if any pending todos match this phase's scope. Presents matches for user to fold in or defer.

**Step 5: Scout codebase.** Lightweight grep/glob scan of existing code. Finds reusable components, established patterns, integration points. This is NOT written to a file -- it is used in-session only.

**Step 6: Analyze phase.** Reads phase goal from ROADMAP.md. Identifies gray areas by domain type:

```
Something users SEE  -> layout, density, interactions, states
Something users CALL -> responses, errors, auth, versioning
Something users RUN  -> output format, flags, modes, error handling
Something users READ -> structure, tone, depth, flow
Something being ORGANIZED -> criteria, grouping, naming, exceptions
```

Generates 3-4 **phase-specific** gray areas, NOT generic categories.

**Step 7: Present gray areas.** Uses `AskUserQuestion(multiSelect: true)`:

```
AskUserQuestion(
  header: "Discuss"
  question: "Which areas do you want to discuss for [phase name]?"
  options: [
    "Layout style -- Cards vs list vs timeline? (Card component exists with variants)",
    "Loading behavior -- Infinite scroll or pagination? (useInfiniteQuery hook available)",
    "Content ordering -- Chronological, algorithmic, or user choice?",
    "Post metadata -- What info per post? Timestamps, reactions, author?"
  ]
  multiSelect: true
)
```

Note the annotations: code context ("Card component exists with variants") and prior decisions ("You chose infinite scroll in Phase 4") are woven into the options.

**Step 8: Deep-dive each area.** For each selected area:

1. Announce: "Let's talk about [Area]."
2. Ask 4 questions using AskUserQuestion with concrete options:
   ```
   AskUserQuestion(
     header: "Layout"
     question: "How should posts be displayed?"
     options: [
       "Cards (reuses existing Card component -- consistent with Messages)",
       "List (simpler, would be a new pattern)",
       "Timeline (needs new Timeline component -- none exists yet)"
     ]
   )
   ```
3. After 4 questions, check: "More questions about [area], or move to next? (Remaining: [list unvisited areas])"
4. If "More" -> 4 more questions, check again
5. If "Next area" -> proceed

After all areas:
```
AskUserQuestion(
  header: "Done"
  question: "We've discussed [list areas]. Which gray areas remain unclear?"
  options: [
    "Explore more gray areas",
    "I'm ready for context"
  ]
)
```

**Step 9: Write CONTEXT.md.** Creates the context file with:

```markdown
# Phase [X]: [Name] - Context

**Gathered:** [date]
**Status:** Ready for planning

<domain>
## Phase Boundary
[Fixed scope from ROADMAP.md]
</domain>

<decisions>
## Implementation Decisions

### [Area 1 that was discussed]
- [Specific decision made]

### Claude's Discretion
[Areas where user said "you decide"]
</decisions>

<canonical_refs>
## Canonical References
[Full paths to every spec/ADR/doc downstream agents must read]
</canonical_refs>

<code_context>
## Existing Code Insights
### Reusable Assets
### Established Patterns
### Integration Points
</code_context>

<specifics>
## Specific Ideas
["I want it like Twitter's new posts indicator"]
</specifics>

<deferred>
## Deferred Ideas
[Ideas captured but out of scope]
</deferred>
```

### 3.3 Scope Creep Prevention

The discuss phase has a hard scope guardrail. From the actual code:

```
The phase boundary comes from ROADMAP.md and is FIXED.
Discussion clarifies HOW to implement what's scoped,
never WHETHER to add new capabilities.

When user suggests scope creep:
"[Feature X] would be a new capability -- that's its own phase.
Want me to note it for the roadmap backlog?
For now, let's focus on [phase domain]."
```

Deferred ideas are captured in the CONTEXT.md `<deferred>` section -- never lost, never acted upon.

### 3.4 Batch Mode and Analysis Mode

- `--batch` flag: Groups 2-5 questions into a single numbered turn instead of one-at-a-time
- `--analyze` flag: Before each question, provides a trade-off analysis table with pros/cons and a recommended approach
- `--auto` flag: Claude auto-selects recommended defaults, logging each choice

---

## 4. Why GSD's Prompts Are "Beautiful"

### 4.1 YAML Frontmatter Structure

Every command file starts with YAML frontmatter that controls tool access and presentation:

```yaml
---
name: gsd:discuss-phase
description: Gather phase context through adaptive questioning
argument-hint: "<phase> [--auto] [--batch] [--analyze]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Task
---
```

The `allowed-tools` field acts as a whitelist -- the agent CANNOT use tools not listed here. This is how GSD prevents the verifier from writing files (no Write tool) or the discuss phase from spawning agents unnecessarily.

### 4.2 XML Tag Architecture

GSD uses XML tags as structural boundaries throughout its prompts. The reason is stated in the codecentric analysis:

> "Claude models were trained to recognize XML tags as structural boundaries, as it is not always clear where a section ends with Markdown headers."

**Command-level XML tags:**

```xml
<objective>      What this command accomplishes
<execution_context>  File references to load via @ syntax
<context>        Runtime variables like $ARGUMENTS
<process>        Step-by-step execution instructions
<success_criteria>   Completion checklist
```

**Agent-level XML tags (more granular):**

```xml
<role>           Mission and spawn context
<philosophy>     Guiding principles
<project_context>    How to discover project-specific rules
<execution_flow>     Step-by-step procedure with named steps
<deviation_rules>    How to handle unexpected situations
<checkpoint_protocol>   When to stop and ask
<task_commit_protocol>   Git commit conventions
<summary_creation>   How to write SUMMARY.md
<success_criteria>   Completion checklist
```

**Within execution flows, each step is a named XML element:**

```xml
<step name="load_project_state" priority="first">
  Load execution context:
  ```bash
  INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init execute-phase "${PHASE}")
  ```
  Parse JSON for: executor_model, commit_docs, phase_dir, plans...
</step>

<step name="execute_tasks">
  For each task:
  1. If type="auto": execute, verify, commit
  2. If type="checkpoint:*": STOP, return structured message
</step>
```

**Artifact-level XML tags (in CONTEXT.md, PLAN.md):**

```xml
<domain>         Phase boundary / scope anchor
<decisions>      Locked implementation decisions
<canonical_refs> Mandatory doc references for downstream agents
<code_context>   Existing code patterns and assets
<specifics>      User's "I want it like X" references
<deferred>       Out-of-scope ideas captured for later
```

### 4.3 The "Plans Are Prompts" Principle

PLAN.md files are NOT documentation that gets converted into prompts. They ARE the prompts. The executor agent reads the PLAN.md directly as its instructions. This means:

```xml
<task type="auto">
  <name>Create login endpoint</name>
  <files>src/app/api/auth/login/route.ts</files>
  <action>Implementation details with specific libraries</action>
  <verify>curl -X POST localhost:3000/api/auth/login</verify>
  <done>Success criteria</done>
</task>
```

The executor reads this XML and executes each task, running the verify command, checking the done criteria, and committing.

### 4.4 Output Formatting Conventions

GSD outputs use consistent visual patterns:

**Phase completion banners:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD > AUTO-ADVANCING TO PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Checkpoint returns (structured markdown):**
```markdown
## CHECKPOINT REACHED

**Type:** human-verify
**Plan:** 1-02
**Progress:** 3/5 tasks complete

### Completed Tasks
| Task | Name        | Commit | Files                        |
| ---- | ----------- | ------ | ---------------------------- |
| 1    | [task name] | [hash] | [key files created/modified] |

### Awaiting
[What user needs to do/provide]
```

**Plan completion:**
```markdown
## PLAN COMPLETE

**Plan:** 1-02
**Tasks:** 5/5
**SUMMARY:** .planning/phases/01-auth/1-02-SUMMARY.md

**Commits:**
- abc1234: feat(1-02): create auth service
- def5678: feat(1-02): add session middleware

**Duration:** 4m 32s
```

**Next steps always shown with `/clear` reminder:**
```
## > Next Up

**Phase 2: Post Feed** -- Display posts from followed users

`/gsd:discuss-phase 2`

/clear first -> fresh context window
```

### 4.5 The Layered Reference Architecture

Commands are thin wrappers. The actual logic lives in workflows, which reference other files:

```
Command (commands/gsd/discuss-phase.md)
  -> Workflow (get-shit-done/workflows/discuss-phase.md)
    -> References (get-shit-done/references/questioning.md)
    -> Templates (get-shit-done/templates/context.md)
    -> Agent defs (agents/gsd-phase-researcher.md)
```

This means:
- Commands define WHAT is allowed (tools, arguments)
- Workflows specify HOW it is done (step-by-step)
- References contain reusable knowledge (questioning guide, checkpoint protocols)
- Templates define output formats (CONTEXT.md, SUMMARY.md, PLAN.md structure)
- Agent definitions specify WHO does it (role, philosophy, execution flow)

---

## 5. Agent Orchestration in Detail

### 5.1 The Thin Orchestrator Pattern

The orchestrator (the command that runs in the main Claude Code session) maintains 15-30% context usage by:

1. Loading only file PATHS via `gsd-tools init` (returns JSON)
2. NEVER embedding file contents into the orchestrator prompt
3. Spawning agents with `Task()` tool -- each gets a fresh 200k context
4. Passing context via `<files_to_read>` blocks, not inline content

### 5.2 Agent Identity Files

Each agent has an identity file in `agents/`. The 16 agents are:

```
gsd-executor.md          # Implements plans with atomic commits
gsd-planner.md           # Creates executable task plans
gsd-plan-checker.md      # Validates plans (9-dimension check)
gsd-phase-researcher.md  # Investigates domain for a phase
gsd-project-researcher.md # Initial project domain research
gsd-research-synthesizer.md # Combines parallel research findings
gsd-verifier.md          # Goal-backward verification
gsd-roadmapper.md        # Requirements & phase extraction
gsd-debugger.md          # Systematic debugging
gsd-codebase-mapper.md   # Analyzes existing codebase
gsd-ui-auditor.md        # Visual UI audit
gsd-ui-checker.md        # UI plan validation
gsd-ui-researcher.md     # UI pattern research
gsd-integration-checker.md # Cross-plan integration check
gsd-nyquist-auditor.md   # Sampling-based quality check
gsd-user-profiler.md     # User preference profiling
```

### 5.3 Agent Definition Structure (Executor Example)

The executor agent definition is the most detailed. Key sections:

**`<role>`**: Mission statement + mandatory initial read requirement
```xml
<role>
You are a GSD plan executor. You execute PLAN.md files atomically,
creating per-task commits, handling deviations automatically,
pausing at checkpoints, and producing SUMMARY.md files.

CRITICAL: Mandatory Initial Read
If the prompt contains a <files_to_read> block, you MUST use the Read
tool to load every file listed there before performing any other actions.
</role>
```

**`<deviation_rules>`**: 4 rules for handling unexpected work:
- Rule 1: Auto-fix bugs (no permission needed)
- Rule 2: Auto-add missing critical functionality (security, validation)
- Rule 3: Auto-fix blocking issues (missing deps, broken imports)
- Rule 4: ASK about architectural changes (new DB tables, switching libs)

**`<analysis_paralysis_guard>`**: If the agent makes 5+ consecutive Read/Grep/Glob calls without any Edit/Write/Bash action, it must STOP and either write code or report blocked. Prevents infinite analysis loops.

**`<authentication_gates>`**: Auth errors (401, 403, "please login") are treated as checkpoint gates, not failures. The agent stops and tells the user what auth steps to take.

**`<task_commit_protocol>`**: Each task gets an individual commit:
```bash
git commit -m "feat(1-02): create auth service

- JWT token generation with jose library
- Refresh token rotation
"
```

Never uses `git add .` -- always stages individual files.

### 5.4 Wave-Based Parallel Execution

The execute-phase orchestrator:

1. Reads all PLAN.md files for the phase
2. Parses `depends_on` frontmatter from each plan
3. Groups independent plans into waves
4. Spawns executor agents in parallel per wave
5. Waits for wave completion before starting next

```
WAVE 1 (parallel)     WAVE 2 (parallel)     WAVE 3
[Plan 01: DB schema]  [Plan 03: API routes]  [Plan 05: Integration]
[Plan 02: Auth service] [Plan 04: Frontend]
```

Each executor gets a fresh 200k context. No context contamination between plans.

### 5.5 The Verifier's Skepticism

The verifier agent has a critical mindset built into its role:

```xml
<core_principle>
Task completion != Goal achievement

A task "create chat component" can be marked complete when the component
is a placeholder. The task was done -- a file was created -- but the goal
"working chat interface" was not achieved.

Do NOT trust SUMMARY.md claims. SUMMARYs document what Claude SAID it did.
You verify what ACTUALLY exists in the code. These often differ.
</core_principle>
```

The verifier uses a 3-level verification:
1. What must be TRUE for the goal to be achieved?
2. What must EXIST for those truths to hold?
3. What must be WIRED for those artifacts to function?

---

## 6. gsd-tools.cjs: The Deterministic Operations Layer

The Node.js CLI handles operations that should NOT be delegated to an LLM because they are mechanical and error-prone when done probabilistically.

### 6.1 State Operations
```bash
gsd-tools state load --json           # Read STATE.md as JSON
gsd-tools state update current_phase=3 # Modify field
gsd-tools state advance-plan          # Increment plan counter
gsd-tools state update-progress       # Recalculate from disk
gsd-tools state add-decision --phase 3 --summary "Use JWT"
gsd-tools state add-blocker "Waiting for API key"
gsd-tools state record-session --stopped-at "Phase 3 planning"
gsd-tools state record-metric --phase 3 --plan 1 --duration 240
```

### 6.2 Phase Operations
```bash
gsd-tools phase next-decimal          # 03 -> 03.1 -> 03.2
gsd-tools phase add                   # Create new phase
gsd-tools phase insert                # Insert + renumber
gsd-tools phase remove                # Remove + cleanup
gsd-tools phase complete              # Mark done, return routing info
```

### 6.3 Init Commands
```bash
gsd-tools init new-project            # Returns config JSON
gsd-tools init phase-op <phase>       # Returns phase state JSON
gsd-tools init execute-phase <phase>  # Returns execution context JSON
gsd-tools init quick                  # Returns quick-mode context JSON
```

### 6.4 Other Operations
```bash
gsd-tools frontmatter get <field>     # Extract YAML field
gsd-tools frontmatter set <field> <val> # Set YAML field
gsd-tools template fill <template> <vars> # Generate from template
gsd-tools verify-summary              # Validate SUMMARY.md structure
gsd-tools verify plan-structure       # Check PLAN.md format
gsd-tools commit "message" --files    # Stage + commit specific files
gsd-tools roadmap update-plan-progress <phase> # Update progress
gsd-tools requirements mark-complete REQ-001  # Check off requirement
gsd-tools todo match-phase <phase>    # Find relevant todos
gsd-tools config-get <key>            # Read config.json value
gsd-tools config-set <key> <value>    # Write config.json value
```

### 6.5 Why This Matters

The principle: "Deterministic logic belongs in code, not in prompts."

Instead of asking Claude to parse YAML frontmatter (probabilistic, sometimes wrong), gsd-tools does it deterministically in Node.js. Instead of asking Claude to calculate the next phase number, gsd-tools handles the edge cases (decimal phases for gap closure: 03 -> 03.1 -> 03.2).

This reduces token usage AND eliminates LLM errors on mechanical tasks.

---

## 7. The .planning/ Directory Structure

All project state lives in markdown files with YAML frontmatter:

```
.planning/
  PROJECT.md                    # Vision, principles, tech stack
  REQUIREMENTS.md               # REQ-IDs, v1/v2/out-of-scope
  ROADMAP.md                    # Phase definitions + success criteria
  STATE.md                      # Current position, decisions, blockers
  config.json                   # Model profiles, workflow toggles
  research/                     # Optional domain research
    STACK.md
    FEATURES.md
    ARCHITECTURE.md
    PITFALLS.md
  phases/
    01-auth/
      01-CONTEXT.md             # Discuss phase output
      01-RESEARCH.md            # Phase-specific research
      01-01-PLAN.md             # Task plan 1
      01-02-PLAN.md             # Task plan 2
      01-01-SUMMARY.md          # Execution results
      01-02-SUMMARY.md
      01-VERIFICATION.md        # QA results
      01-UAT.md                 # Manual testing checklist
    02-feed/
      ...
  quick/                        # Ad-hoc quick tasks
    001-add-dark-mode/
      PLAN.md
      SUMMARY.md
  milestones/                   # Archived completed phases
```

### 7.1 STATE.md Dual-Track Storage

STATE.md uses YAML frontmatter synchronized with narrative body:

```yaml
---
current_phase: 3
position: plan
decisions:
  - Auth mechanism: OAuth 2.0
  - API rate limit: 100 req/min
blockers:
  - Waiting for design review
metrics:
  plans_completed: 5
  tests_passed: 42
---

## Current Position
Phase: 3 (Database Schema)
Status: Planning
...
```

Both are kept in sync by `gsd-tools state update`.

### 7.2 Requirements Traceability

REQ-IDs flow through the entire system:

```
REQUIREMENTS.md (REQ-001, REQ-002...)
    |
    v  (phase assignments)
ROADMAP.md (Phase 1: REQ-001, REQ-003)
    |
    v  (passed to planner)
01-01-PLAN.md (requirements: [REQ-001])
    |
    v  (executed + committed)
01-01-SUMMARY.md (implemented REQ-001)
    |
    v  (verified against)
01-VERIFICATION.md (REQ-001: PASS/FAIL)
    |
    v  (marked complete)
REQUIREMENTS.md (REQ-001: [x])
```

---

## 8. GSD-2: How It Differs from v1

GSD-2 is a **completely different architecture**. While v1 is a set of Claude Code slash commands (prompt files), v2 is a **standalone CLI built on the Pi SDK** that manages agent sessions programmatically.

### 8.1 Key Architectural Differences

| Aspect | v1 | v2 |
|--------|----|----|
| Runtime | Claude Code slash commands | Standalone CLI (`gsd-pi`) |
| Context management | LLM accumulates within session | State machine reading disk files |
| Crash recovery | None | Lock files + session forensics |
| Git strategy | LLM writes git commands | Worktree isolation + squash merge |
| Cost tracking | None | Per-unit token/cost ledger |
| Stuck detection | None | Retry once, then diagnostic stop |
| Auto mode | LLM self-loop | TypeScript state machine |
| Multi-terminal | Not supported | Two-terminal workflow |

### 8.2 Work Hierarchy

v2 replaces v1's "phases + plans" with a 3-level hierarchy:

```
Milestone -> shippable version (4-10 slices)
  Slice -> demoable vertical capability (1-7 tasks)
    Task -> single context-window unit of work
```

**Iron rule: "A task must fit in one context window. If it can't, it's two tasks."**

### 8.3 Commands

```bash
gsd              # Launch interactive session
/gsd next        # Step mode -- one unit at a time
/gsd auto        # Autonomous mode -- full loop
/gsd quick       # Skip planning overhead
/gsd status      # Real-time dashboard
/gsd discuss     # Architecture discussion (safe during auto)
/gsd migrate     # Convert v1 .planning/ -> .gsd/ format
```

### 8.4 Git Strategy

v2 uses git worktrees for isolation:

```
Branch per slice: gsd/M001/S01, gsd/M001/S02
Sequential commits within milestone branch
Squash merge to main as one clean commit
Auto-cleanup after merge
```

### 8.5 Two-Terminal Workflow

```
Terminal 1 (let it build):     Terminal 2 (steer while working):
  gsd                           gsd
  /gsd auto                     /gsd discuss    # decisions
                                /gsd status     # progress
                                /gsd queue      # queue next milestone
```

Both terminals share `.gsd/` files. Decisions in terminal 2 are picked up at the next phase boundary.

### 8.6 Artifacts

| File | Purpose |
|------|---------|
| `PROJECT.md` | Living project state |
| `DECISIONS.md` | Append-only architectural decisions |
| `STATE.md` | Quick-glance dashboard |
| `M001-ROADMAP.md` | Milestone plan |
| `M001-CONTEXT.md` | User decisions |
| `M001-RESEARCH.md` | Research findings |
| `S01-PLAN.md` | Slice task plan |
| `T01-PLAN.md` | Individual task plan |
| `T01-SUMMARY.md` | YAML frontmatter + narrative |
| `S01-UAT.md` | Human test script |

### 8.7 Headless Mode

v2 supports CI/cron execution:

```bash
gsd headless --timeout 600000    # Auto mode in CI
gsd headless next                # One unit (cron-friendly)
gsd headless query               # Instant JSON state (~50ms, no LLM)
```

Exit codes: 0 (complete), 1 (error/timeout), 2 (blocked).

### 8.8 Cost Management

v2 tracks tokens and costs per phase, slice, model:

```yaml
# ~/.gsd/preferences.md
budget_ceiling: 50.00
auto_report: true
```

Budget ceiling pauses auto mode if exceeded. Model fallback chains handle transient errors.

### 8.9 HTML Reports

Auto-generated after milestones:
- Project summary, progress tree, dependency DAGs
- Cost/token metrics with charts
- Execution timeline, changelog
- Self-contained (CSS/JS inlined), PDF-printable

---

## 9. Prompt Engineering Techniques Catalog

### 9.1 XML Tags for Structural Clarity

GSD never uses markdown headers alone for prompt sections. XML tags create unambiguous boundaries:

```xml
<objective>...</objective>           # Top-level goal
<execution_context>...</execution_context>  # What to load
<process>...</process>               # How to do it
<step name="X">...</step>           # Named sub-procedures
<role>...</role>                     # Agent identity
<philosophy>...</philosophy>         # Guiding principles
<deviation_rules>...</deviation_rules>     # Error handling
<success_criteria>...</success_criteria>   # Completion check
```

### 9.2 `@`-Reference Pattern

Context is injected via file references, not inline content:

```xml
<execution_context>
@~/.claude/get-shit-done/workflows/discuss-phase.md
@~/.claude/get-shit-done/references/questioning.md
@~/.claude/get-shit-done/templates/context.md
</execution_context>
```

This is a Claude Code feature -- `@path` causes the file to be loaded into context. GSD uses this extensively to keep command files thin while loading detailed workflows.

### 9.3 Downstream Awareness

Agents are told WHO will consume their output and WHY:

```xml
<downstream_awareness>
CONTEXT.md feeds into:

1. gsd-phase-researcher -- Reads CONTEXT.md to know WHAT to research
   - "User wants card-based layout" -> researcher investigates card patterns

2. gsd-planner -- Reads CONTEXT.md to know WHAT decisions are locked
   - "Pull-to-refresh on mobile" -> planner includes that in task specs
</downstream_awareness>
```

This prevents agents from writing vague outputs -- they know exactly who needs their work and for what purpose.

### 9.4 Anti-Pattern Lists

GSD explicitly lists what NOT to do, not just what to do:

```xml
<anti_patterns>
- Checklist walking
- Canned questions
- Corporate speak
- Interrogation
- Rushing
- Shallow acceptance
- Premature constraints
- User skills -- NEVER ask about user's technical experience
</anti_patterns>
```

### 9.5 Concrete Examples Over Abstract Rules

Every guideline comes with good/bad examples:

```
Good content (concrete decisions):
- "Card-based layout, not timeline"
- "Retry 3 times on network failure, then fail"

Bad content (too vague):
- "Should feel modern and clean"
- "Good user experience"
```

### 9.6 The Freeform Escape Hatch

When AskUserQuestion feels constraining:

```xml
<freeform_rule>
When the user wants to explain freely, STOP using AskUserQuestion.

If user selects "Other" and their response signals they want to describe
something in their own words, you MUST:
1. Ask follow-up as plain text -- NOT via AskUserQuestion
2. Wait for them to type at the normal prompt
3. Resume AskUserQuestion only after processing their freeform response
</freeform_rule>
```

### 9.7 Deterministic State Before Prompt Logic

Every workflow starts by loading state via gsd-tools (Node.js), not by asking Claude to parse files:

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init phase-op "${PHASE}")
```

This returns structured JSON with all the fields the workflow needs. The prompt then references these fields. No ambiguity, no parsing errors.

### 9.8 Context Budget Awareness

The planner includes a quality degradation table:

```
| Context Usage | Quality    | Claude's State                |
|---------------|------------|-------------------------------|
| 0-30%         | PEAK       | Thorough, comprehensive       |
| 30-50%        | GOOD       | Confident, solid work         |
| 50-70%        | DEGRADING  | Efficiency mode begins        |
| 70%+          | POOR       | Rushed, minimal               |
```

**Rule: Plans should complete within ~50% context. More plans, smaller scope, consistent quality.**

### 9.9 Named Steps with Priority

Workflow steps are XML elements with explicit names and optional priorities:

```xml
<step name="load_project_state" priority="first">
```

This makes it trivially clear to the LLM what to do first and how to reference steps.

### 9.10 Guards Against Common LLM Failure Modes

- **Analysis paralysis guard**: 5+ consecutive Read/Grep without Write = STOP
- **Fix attempt limit**: 3 auto-fix attempts per task, then document and move on
- **Scope boundary**: Only fix issues DIRECTLY caused by current task's changes
- **Authentication gate detection**: 401/403 = checkpoint, not bug
- **Auto-advance chain flattening**: Uses Skill() instead of nested Task() to prevent runtime freezes from deep agent nesting

---

## 10. Model Profile System

GSD supports 3 profiles that select different Claude models per role:

```json
{
  "model_profiles": {
    "quality": {
      "orchestrator": "claude-opus-4-6",
      "planner": "claude-opus-4-6",
      "executor": "claude-sonnet-4-6"
    },
    "balanced": {
      "orchestrator": "claude-opus-4-6",
      "planner": "claude-sonnet-4-6",
      "executor": "claude-sonnet-4-6"
    },
    "budget": {
      "orchestrator": "claude-sonnet-4-6",
      "planner": "claude-sonnet-4-6",
      "executor": "claude-haiku-4"
    }
  }
}
```

Switch with `/gsd:set-profile budget`. The init commands return the appropriate model for each agent spawn.

---

## 11. Multi-Runtime Deployment

GSD's `bin/install.js` transforms source definitions for 6 runtimes:

| Runtime | Transformation |
|---------|---------------|
| Claude Code | Minimal (path replacement) |
| OpenCode | Frontmatter restructuring, tool name lowercase |
| Gemini CLI | Snake_case tools, HTML stripping, TOML generation |
| Codex | Skill adapters, dual-file configs, TOML merging |
| Copilot | Skill format, .agent.md files |
| Antigravity | Minimal, inherits Gemini mappings |

Tool name mapping example:
```javascript
const claudeToGeminiTools = {
  'Read': 'read_file',
  'Write': 'write_file',
  'Edit': 'replace',
  'Bash': 'run_shell_command',
  'AskUserQuestion': 'ask_user'
};
```

---

## 12. Complete Workflow Sequence (End-to-End)

Here is the exact sequence from "I have an idea" to "shipped":

```
1. /gsd:new-project
   User types idea. Claude interviews (5-15 questions).
   4 parallel research agents investigate domain.
   Synthesizer combines findings.
   Roadmapper creates REQUIREMENTS.md + ROADMAP.md.
   -> PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md created

2. /clear  (fresh context window)

3. /gsd:discuss-phase 1
   Claude loads prior context, scouts codebase.
   Identifies gray areas by domain type.
   Presents multi-select: which to discuss?
   Deep-dives each area: 4 questions per area.
   -> 01-CONTEXT.md created

4. /clear

5. /gsd:plan-phase 1
   gsd-phase-researcher investigates (reads CONTEXT.md).
   -> 01-RESEARCH.md created
   gsd-planner creates atomic task plans (2-3 tasks each).
   -> 01-01-PLAN.md, 01-02-PLAN.md created
   gsd-plan-checker validates (9-dimension check).
   If rejected: planner revises. Max 2 iterations.

6. /clear

7. /gsd:execute-phase 1
   Orchestrator groups plans into waves.
   Wave 1: spawns executor agents in parallel.
   Each executor: reads PLAN.md, implements, commits per task.
   -> 01-01-SUMMARY.md, 01-02-SUMMARY.md created
   Wave 2: dependent plans execute.
   STATE.md + ROADMAP.md updated.

8. /clear

9. /gsd:verify-work 1
   gsd-verifier reads phase goal (not task completion).
   3-level check: truths / artifacts / wiring.
   -> 01-VERIFICATION.md created
   If gaps: creates gap-closure plans.
   -> /gsd:plan-phase 1 --gaps to fix

10. /gsd:ship 1  (create PR)
    or
    /gsd:discuss-phase 2  (next phase)
    or
    /gsd:complete-milestone  (archive and tag release)
```

**With --auto flag, steps 2-9 chain automatically.** The user types:
```
/gsd:new-project --auto
```
...provides the initial idea and answers config questions, then walks away. GSD chains discuss -> plan -> execute for each phase automatically.

---

## 13. Key Takeaways for Emberdeck

### What makes GSD effective:

1. **XML tags > markdown headers** for prompt structure. Claude reliably parses XML boundaries.

2. **Downstream awareness** in every agent output. Agents know who consumes their work and why.

3. **Deterministic operations in code, not prompts.** YAML parsing, state updates, phase calculations -- all in Node.js.

4. **AskUserQuestion with concrete options.** Never abstract. Always annotated with code context and prior decisions.

5. **Scope guardrails are explicit and aggressive.** "That's its own phase. I'll note it for later."

6. **Anti-pattern lists** alongside best practices. Telling the LLM what NOT to do is as important as what to do.

7. **Plans are prompts, not documents.** No translation layer between plan and execution.

8. **Fresh context per agent.** The orchestrator stays thin (15-30%). Each worker gets a full 200k window.

9. **Goal-backward verification.** Don't check if tasks completed -- check if the GOAL was achieved.

10. **The questioning philosophy.** "Dream extraction, not requirements gathering." Follow energy, challenge vagueness, make abstract concrete.
