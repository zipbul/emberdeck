> ⚠️ **Historical document.** Written when emberdeck shipped as an MCP server. emberdeck is now CLI-only (commit `c23851b`); MCP-specific paths and tool registrations in this file no longer apply. Design intent and analysis content remain valid.

# Research: Agentic Coding Workflows
## How AI Coding Agents Work, Where They Fail, and Where Structured Context Matters Most

*Research compiled 2026-03-16*

---

## Table of Contents

1. [The Agentic Coding Lifecycle](#1-the-agentic-coding-lifecycle)
2. [How Specific Agents Work Internally](#2-how-specific-agents-work-internally)
3. [Context Engineering for Coding Agents](#3-context-engineering-for-coding-agents)
4. [Where Agents Fail: Failure Patterns and Root Causes](#4-where-agents-fail)
5. [Spec-Driven vs Vibe Coding Workflows](#5-spec-driven-vs-vibe-coding)
6. [Multi-Agent Coding Patterns](#6-multi-agent-coding-patterns)
7. [The Three Developer Loops](#7-the-three-developer-loops)
8. [Where Structured Project Knowledge Is Most Valuable](#8-where-structured-project-knowledge-is-most-valuable)

---

## 1. The Agentic Coding Lifecycle

### The Universal Agent Loop

Every AI coding agent operates on the same fundamental loop:

```
RECEIVE TASK -> GATHER CONTEXT -> PLAN -> IMPLEMENT -> VERIFY -> ITERATE (or COMPLETE)
```

This is a `while(tool_call)` loop. The agent receives an objective, breaks work into steps, executes code, analyzes results, and iterates until the desired outcome is achieved. Unlike autocomplete or chat, an agentic agent **plans before coding** -- analyzing project context, dependencies, and existing conventions.

### The PEV Framework (Plan / Execute / Verify)

The most widely adopted framework across all major agents:

**PLAN Phase** (Where engineering expertise matters most):
- Define objective and acceptance criteria ("What does 'done' look like?")
- Decompose complex goals into agent-sized work units
- Set architectural boundaries, tech stack rules, style guides
- Specify quality gates (required tests, review thresholds)
- Assign agent roles (implementation, testing, security review)
- A vague plan produces vague code; a precise plan with clear constraints produces focused, reviewable output

**EXECUTE Phase** (Agents work autonomously within constraints):
- Implementation agents write code following architectural rules
- Test agents generate and run test suites
- Review agents check style, security, architectural compliance
- Agents iterate until work passes quality gates
- Human intervention only when agents encounter obstacles or require judgment on trade-offs

**VERIFY Phase** (Where human judgment is most critical):
- Acceptance criteria compliance
- Security vulnerability introduction
- Architectural consistency with existing codebase
- Test meaningfulness (avoiding shallow happy-path checks)
- Verification is NOT rubber-stamping -- it requires evaluating whether the solution is not just functional but *good*

### The Four-Phase Spec-Driven Variant

GitHub's Spec Kit and similar tools add structure:

1. **Specify**: High-level description -> AI generates detailed spec (user journeys, success criteria)
2. **Plan**: Developer sets tech stack/architecture -> AI generates implementation plan
3. **Tasks**: Spec + plan decomposed into small, reviewable work units
4. **Implement**: AI tackles tasks sequentially with developer reviewing focused changes

Each phase follows: deterministic pre-events set up context -> agent does creative work -> deterministic post-events validate output -> fail loop sends agent back for another attempt.

### The Gated State Machine

A rule-based workflow engine enforces phase transitions:
- Requirements must be complete before tasks can be generated
- Architecture must be reviewed before implementation starts
- Each artifact has a state machine: `draft -> in-review -> approved -> complete`
- A critic agent handles judgment calls ("Can each acceptance criterion be verified with a test? Are any ambiguous?")

---

## 2. How Specific Agents Work Internally

### Claude Code

**Architecture**: A command-line orchestration layer connecting Claude models (Opus, Sonnet, Haiku) to the local development environment. The entire execution model is a straightforward `while(tool_call)` loop with **no classifiers, no RAG pipeline, no DAG orchestrator**. The model itself decides everything.

**Context Strategy** (hybrid model):
- **Upfront**: CLAUDE.md files dropped directly into context at session start
- **Just-in-time**: Glob and grep primitives (ripgrep) for file navigation -- Anthropic switched to grep-based search after benchmarks showed superior performance with lower operational complexity
- **Compaction**: Message history summarization preserving architectural decisions
- **Reference**: Recent file access retained alongside compressed history
- **Skills**: Lazy-loaded resource packages the agent activates when task-relevant
- **Sub-agents**: Isolated execution contexts with independent context windows for focused sub-tasks

**Recommended Workflow**: Split work into 4 phases: Research -> Plan -> Implement -> Validate. Clear context between each.

**Key Design Decision**: System prompt and tool descriptions kept static to maximize prompt caching. No personalized/dynamic prompt elements.

### Cursor

**Architecture**: VSCode fork with agentic LLM system. Uses Claude 3.5 Sonnet as primary reasoning model with specialized smaller models for subtasks.

**Agent Loop**: Iterative tool invocation -- agent receives task, makes tool calls, client computes results, feeds back. Tools include `read_file()`, `write_file()`, `run_command()`, `codebase_search()`, `grep_search()`, `edit_file()`.

**Edit Pipeline** (semantic diff approach):
1. Main agent produces "semantic diff" with code comments guiding insertion
2. Cheaper/faster apply-model converts to actual file contents, fixes syntax
3. Result passes through linting
4. Lint feedback returns to agent for self-correction

**Context Strategy**:
- Vector-based code search with encoder LLMs at indexing time, re-ranking at query time
- @-tag syntax for explicit file/folder attachment
- System prompt entirely static for prompt caching
- File size optimization: breaks files to under 500 lines for reliable editing
- Self-correction limit: max 3 loops on linter errors

**Multi-Agent**: Can run up to 8 agents simultaneously, each in isolated Git worktrees or remote machines.

### Devin

**Architecture**: LLM with tools, memory, and reasoning, mimicking a junior developer. Operates in its own secure cloud workspace with editor, terminal, and browser.

**Workflow**: Sequential decision-making approach:
1. Receives task in natural language
2. Spins up cloud environment
3. Shows its plan while implementing
4. At each step: writes code, compiles, runs tests, checks for errors
5. Uses RL to learn from iterative feedback
6. Delivers result as a pull request

**Key Feature**: Full replay timeline -- every terminal command, file edit, and browser action is recorded.

### Aider

**Architecture**: Repository map system using AST-powered analysis.

**Context Strategy** (three-tier prioritization):
1. **Always included**: System instructions + repository map (function signatures, file structures -- NOT full implementations)
2. **Dynamically selected**: Relevant file contents, dependency-linked files, codebase pattern examples
3. **Lowest priority**: Chat history beyond recent exchanges, unrelated docs

Claims 98% reduction in token usage vs dumping entire codebases into context.

**Architect/Editor Split**: Separates coding into two steps:
- **Architect model**: Problem-solving and solution design
- **Editor model**: Translates Architect's solution into specific code edits
- This produced SOTA results: o1-preview (Architect) + DeepSeek/o1-mini (Editor) scored 85% on code editing benchmark

**Multi-File Coordination**:
- Relationship mapping across affected files upfront
- Coordinated suggestion generation across layers
- Consistency validation between modifications
- ~85% success rate for multi-file integration vs ~40% for single-file approaches

### OpenAI Codex

**Architecture**: Powered by codex-1 (o3 optimized for software engineering), now consolidated into GPT-5 family.

**Agent Loop**: Receive input -> prepare prompt -> query model (inference) -> process response -> if tool_call, execute and loop back -> if complete, return assistant message.

**Key Feature**: Each task runs in its own cloud sandbox preloaded with repository. Can be exposed as MCP server for multi-agent orchestration via Agents SDK.

### Gemini CLI

**Architecture**: ReAct (Reason and Act) loop with built-in tools and MCP servers.

**Skills Architecture**: Modular packages giving the CLI a specific persona, instructions, and access to local scripts/reference documents. At session start, Gemini scans discovery tiers and injects skill names/descriptions into system prompt. When task matches a skill description, it calls `activate_skill` tool.

**Hooks System**: Scripts executed at predefined lifecycle points (middleware pattern). Can validate content before writes, block operations, provide self-correction feedback.

### Cline

**Architecture**: Open-source autonomous agent in VS Code sidebar.

**Plan + Act Model**: Separates thinking from doing:
- **Plan mode**: Analyzes request, explores codebase, proposes approach WITHOUT modifying anything. "Read more files, get more data."
- **Act mode**: Executes -- creates files, edits code, runs commands -- with user approval at each step.

**Human-in-the-loop**: GUI approval for every file change and terminal command.

---

## 3. Context Engineering for Coding Agents

### Core Principle

"Claude is already smart enough -- intelligence is not the bottleneck, context is." Context engineering is the systematic curation of what the model sees to maximize desired outcomes.

### The Fundamental Law

**Find the smallest possible set of high-signal tokens that maximize desired outcomes.** Context is a finite resource with diminishing returns -- models experience reduced precision as context length increases ("context rot").

### Context Categories

| Category | Description | Loading Strategy |
|----------|-------------|-----------------|
| **System Prompts** | Project conventions, boundaries, roles | Always loaded at session start |
| **Tools** | Capabilities the agent can invoke | Available throughout session |
| **Rules/CLAUDE.md** | Coding standards, architecture decisions | Always loaded or file-type triggered |
| **Skills** | Task-specific resource packages | Lazy-loaded when LLM deems relevant |
| **Examples** | Few-shot demonstrations of expected behavior | Curated and included in prompts |
| **Codebase** | The actual source code | Just-in-time via search/read tools |
| **External Knowledge** | Docs, APIs, tickets | Via MCP servers or explicit inclusion |

### Progressive Context Building

1. Start with minimal project context
2. Gradually add detail based on observed AI behavior
3. Don't pump too much in right from the start
4. Models have gotten powerful enough that what you had to include 6 months ago may no longer be necessary

### Just-In-Time Context (Key Strategy)

Rather than pre-loading all relevant data, maintain lightweight identifiers (file paths, URLs, queries) and **dynamically load information as needed using tools**.

Benefits:
- Reduces token consumption
- Metadata (file paths, timestamps, naming conventions) provides behavioral signals
- Enables progressive disclosure -- agents incrementally discover context through exploration

Example: Claude Code analyzes large databases by writing targeted queries and using Bash commands (head, tail) rather than loading entire datasets.

### Compaction (Long Sessions)

When approaching context limits:
1. Summarize conversation contents
2. **Preserve**: architectural decisions, unresolved issues, implementation details
3. **Discard**: redundant tool outputs and messages
4. Reinitiate with compressed context + recently accessed files
5. Tuning: start by maximizing recall, then iterate to improve precision

### Structured Note-Taking (Agentic Memory)

Agents maintain persistent notes outside the context window:
- Similar to NOTES.md or to-do lists
- Track progress across complex tasks
- Maintain critical dependencies that would otherwise be lost
- Retrieved after context resets

Example: Claude playing Pokemon maintained multi-hour coherence via maps, achievements, and strategic notes retrieved after context resets.

### Sub-Agent Architectures

Specialized sub-agents handle focused tasks with clean context windows:
- Each explores extensively but returns only condensed summaries (1,000-2,000 tokens)
- Main agent synthesizes results without managing all detailed context
- Prevents context pollution across different concerns

### Spotify's Hard-Won Lessons

After scaling to thousands of repos, Spotify found:

1. **Tailor prompts to agent type**: Claude Code works better with end-state descriptions; other agents prefer step-by-step instructions
2. **State preconditions**: "Agents are eager to act, to a fault." Explicitly specify when NOT to act
3. **Use concrete code examples**: Having examples "heavily influences the outcome"
4. **Define verifiable goals**: Abstract requests like "make this better" fail; agents need measurable objectives (passing tests)
5. **Atomize changes**: Combining multiple modifications exhausts context and produces partial results
6. **Seek agent feedback**: After execution, agents can identify missing prompt information

Spotify's tool strategy: Only 3 limited, standardized tools (Verify, Git, Bash). They prefer "larger static prompts, which are easier to reason about" because they're version-controllable and testable.

### CLAUDE.md Best Practices

- Keep under 300 lines (shorter is better)
- Only include universally applicable instructions
- Structure into distinct sections using XML tags or Markdown headers
- Claude automatically merges multiple CLAUDE.md files based on directory structure
- Rules files can be path-scoped (e.g., `*.sh` files get shell-specific conventions)

### AI-Friendly Codebase Design

Your codebase itself is primary context:
- Use unique filenames (avoid multiple `page.js`)
- Organize hot-paths into same files/folders
- Keep files under 500 lines
- Maintain rich docstrings and comments (these substantially influence embedding quality)
- Well-organized, documented code requires less supplementary guidance

---

## 4. Where Agents Fail: Failure Patterns and Root Causes

### Quantitative Data

CodeRabbit's analysis of 470 GitHub repositories:
- **AI created 1.7x as many bugs as humans**
- Critical/major issues: 1.3-1.7x more frequent
- Logic/correctness errors: **75% more** (194 per 100 PRs) -- the most dangerous because they "look like reasonable code"
- Security issues: 1.5-2x higher rate
- Concurrency/dependency mistakes: 2x higher
- Error handling gaps: 2x higher
- Performance anti-patterns: ~8x higher
- Readability issues: 3x higher

### The 8 Failure Patterns of AI-Generated Code

1. **Hallucinated APIs**: 1 in 5 AI code samples references fake libraries. Agent suggests plausible-sounding but non-existent packages/methods.

2. **Security vulnerabilities that look functional**: 45% of AI code contains security vulnerabilities; 70%+ failure rate in Java. Code works but fails security scrutiny.

3. **Performance anti-patterns**: O(n^2) where O(n) exists, string concatenation in loops, memory allocations that should be reused. Don't surface until production scale.

4. **Error handling that assumes happy paths**: Missing edge case handling, silent failures, stack trace exposure. Training data overrepresents common scenarios.

5. **Missing edge cases**: Empty arrays, null values, max integers, unicode. Works with typical inputs, fails at boundaries.

6. **Outdated library usage**: Deprecated APIs from older training data, reintroducing patched vulnerabilities.

7. **Data model mismatches**: Code assumes data structures that don't match actual API responses or database schemas. Agent guesses based on variable names, not actual schemas.

8. **Missing context dependencies**: Works in isolation, fails when integrated. Missing environment variables, undefined configuration, unavailable cross-service dependencies.

### The Whack-a-Mole Problem

Root cause: Without understanding underlying patterns, you play whack-a-mole with code you don't fully understand. Agent fixes issue in one place but doesn't update scripts, configs, or processes that actually need the fix. The "fix" is local, not systemic.

### The Compounding Error Problem

When agents run autonomously for long periods, mistakes (hallucinations, context errors, slight missteps) **compound over running time**. By the end, errors are baked into the code. This is fundamental to long-horizon agent work.

### The Assumptions Problem

LLMs are statistically biased toward forcing solutions rather than asking clarifying questions. Research confirms that "when presented with scenarios where critical information is missing, LLMs rarely pause to request it." They assume:
- Functional requirements without verification
- Database architecture without checking
- Technology stack choices without validation
- Implementation approaches without confirmation

### The 70% Problem

Non-engineers hit a wall at ~70% completion. The final 30% requires:
- Polished error messaging
- Graceful edge case handling
- Accessibility considerations
- Performance optimization
- True production readiness

Senior engineers constantly refactor AI output: breaking into focused modules, adding edge case handling, strengthening types, questioning architectural decisions.

### Silent Failures (The Most Dangerous)

Recent LLMs generate code that fails to perform as intended but **appears to run successfully** -- avoiding syntax errors or obvious crashes by removing safety checks or creating fake output.

### Where Code Health Matters

"Low Code Health increases the likelihood that agents fail on their task or, at best, burn excess tokens." Research shows non-linear relationships -- targeting Code Health scores of 9.5+, ideally 10.0. Agents working on unhealthy code produce worse results.

---

## 5. Spec-Driven vs Vibe Coding

### The Spectrum

| | Vibe Coding | Agentic Engineering |
|---|---|---|
| **Approach** | Casual, free-form prompting | Structured planning + verification |
| **Specs** | None | Living, executable artifacts |
| **Quality Gates** | Manual/ad-hoc | Automated + human review |
| **Output** | Fast demos | Production software |
| **Control** | Reactive | Proactive |

### Why Specs Change Everything

Language models excel at pattern completion but **cannot read minds**. Clear specifications eliminate guesswork by providing unambiguous instructions.

A good spec explicitly defines:
- Input/output mappings
- Preconditions/postconditions
- Invariants and constraints
- Interface types
- Integration contracts
- Sequential logic/state machines

### The Six Core Areas Every Spec Must Cover

Research of 2,500+ agent configuration files reveals failures stem from missing:

1. **Commands**: Executable commands with full flags
2. **Testing**: Framework details, test locations, coverage expectations
3. **Project structure**: Clear directory organization
4. **Code style**: Real code examples of preferred conventions
5. **Git workflow**: Branch naming, commit formats, PR requirements
6. **Boundaries**: Three-tier system:
   - **Always safe**: Actions without human approval
   - **Ask first**: High-impact changes requiring oversight
   - **Never**: Hard stops (never commit secrets)

### Spec as Source of Truth

The strategic shift: from **code as source of truth** to **intent as source of truth**. Specifications become executable artifacts determining what gets built. Both human and agent refer back to the same spec throughout.

---

## 6. Multi-Agent Coding Patterns

### Orchestrator-Worker (Most Common)

The hub-and-spoke model:
- Single orchestrator receives task, decomposes into subtasks
- Assigns each subtask to specialized worker agent
- Workers do NOT communicate with each other
- All coordination flows through orchestrator
- Orchestrator maintains global state, handles error recovery, decides when overall task is complete

Workers are stateless (or maintain only local state) and focus on a single capability.

**Why it's the default**: Easiest to debug (single control flow), scales horizontally by adding workers.

### The Seven-Role Agent Team

| Role | Function |
|------|----------|
| Feature Author | Implementation code writing |
| Test Generator | Unit, integration, E2E test creation |
| Code Reviewer | Style, pattern, security checking |
| Architecture Guardian | Structural compliance validation |
| Documentation Writer | Doc-code synchronization |
| Security Scanner | Vulnerability identification |
| Release Manager | CI/CD and deployment management |

Agents operate in pipeline: each agent's output feeds the next, with humans at critical checkpoints.

### Other Orchestration Patterns

- **Swarm**: Decentralized, peer-to-peer with handoff protocols
- **Mesh**: Bidirectional communication between agents
- **Hierarchical**: Multiple levels of orchestration
- **Pipeline**: Linear, sequential processing

### Practical Multi-Agent Implementation

- Each agent gets its own Git worktree, branch, and PR
- When CI fails, the agent fixes it
- Inter-agent messaging via typed protocol messages (e.g., SQLite mail system)
- Claude Code sub-agents: Lead agent coordinates work, assigns subtasks, merges results

### Context Requirements for Orchestrators

The orchestrator needs:
- **Global state**: Full picture of project, all active tasks, dependencies between tasks
- **Task specifications**: Clear definition of what each worker should produce
- **Quality criteria**: How to evaluate worker output
- **Dependency graph**: Which tasks depend on which (ordering constraints)
- **Error handling strategy**: What to do when a worker fails

Workers need:
- **Focused context**: Only information relevant to their specific subtask
- **Clean context window**: No pollution from other workers' concerns
- **Clear success criteria**: What constitutes "done" for their task
- **Interface contracts**: How their output connects to other components

---

## 7. The Three Developer Loops

### Inner Loop (Seconds to Minutes)

The moment-to-moment collaboration: request -> output -> verify.

**Prevention**: Break work into minimal components. Commit 4x more frequently than traditional development. Write specs before coding. Have AI generate tests as part of specification.

**Detection**: Independently verify AI claims. Monitor for signs AI is ignoring instructions or losing context. Use TDD for immediate feedback.

**Correction**: Decide quickly whether to fix forward or revert. Run multiple quality passes. Manually intervene when AI enters debugging loops.

### Middle Loop (Hours to Days)

Cross-session coordination and context persistence.

**Prevention**: Document progress in persistent files before session ends. Maintain AGENTS.md/CLAUDE.md. Structure code for AI capabilities. Define clear boundaries between agents' work areas.

**Detection**: Watch for architectural drift and lost context. Identify conflicts between multiple agents. Audit code quality degradation over time.

**Correction**: Use "tracer bullets" (minimal end-to-end implementations). Automate coordination. Develop conflict untangling protocols.

### Outer Loop (Weeks to Months)

Strategic architecture and long-term sustainability.

**Prevention**: Preserve APIs despite rapid changes. Partition workspaces. Enforce minimal, modular implementations. Proportional review by risk level.

**Detection**: Enhanced CI/CD with security reviews. Monitor for branch conflicts/data loss. Wire agents into production monitoring.

**Correction**: Recovery protocols for merge conflicts. AI for architectural modernization.

---

## 8. Where Structured Project Knowledge Is Most Valuable

### Critical Analysis: At Which Points in the Agent Lifecycle Does Structured Knowledge Matter Most?

Based on all research, here are the exact moments where specs, relationships, code links, and impact analysis would have the highest value:

#### MOMENT 1: Task Understanding (Before Planning)

**What agents need**: Understanding of what the task IS in the context of the full system.

**What's missing today**: Agents start with a prompt and a flat codebase. They don't know:
- Which components are affected by this change
- What the dependency chain looks like
- What other features depend on the code being modified
- What the historical context of the code is (why it was built this way)

**Impact of structured knowledge**: A relationship map showing "changing X will affect Y and Z" would prevent the #1 failure mode: agents making changes without understanding systemic impact. This directly addresses the **whack-a-mole problem**.

#### MOMENT 2: Context Gathering (During Planning)

**What agents need**: The RIGHT files, not ALL files.

**What's missing today**: Agents use grep/glob to find relevant files. This is inherently keyword-based and misses:
- Indirect dependencies (A doesn't reference B by name, but depends on B's behavior)
- Cross-boundary relationships (frontend component depends on backend API contract)
- Configuration dependencies (code depends on env vars defined elsewhere)

**Impact of structured knowledge**: A pre-computed dependency graph would replace the agent's blind search with targeted file retrieval. This directly addresses **Pattern #8 (missing context dependencies)** and **Pattern #7 (data model mismatches)**.

#### MOMENT 3: Impact Analysis (Before Implementation)

**What agents need**: Understanding of what their change will break.

**What's missing today**: No agent currently does systematic impact analysis before coding. They:
- Modify a file without knowing what depends on it
- Change an interface without updating all consumers
- Alter behavior without updating tests that assert that behavior

**Impact of structured knowledge**: An impact analysis system that says "if you change function X in file A, you need to also update files B, C, and D which depend on it, and tests E and F which assert its behavior" would be transformative. This directly addresses the **compounding error problem** and the **silent failure pattern**.

#### MOMENT 4: Verification Grounding (During Testing)

**What agents need**: Knowledge of WHAT to test and WHERE tests live.

**What's missing today**: Agents often write new tests from scratch without checking if:
- Existing tests already cover this behavior
- There are integration tests that need updating
- The test patterns used elsewhere in the project differ from what they're generating

**Impact of structured knowledge**: A test-to-code mapping would let agents find existing tests for the code they modified, run them first, and write new tests only for uncovered paths.

#### MOMENT 5: Cross-Session Continuity (Between Sessions / During Compaction)

**What agents need**: Persistent knowledge of what was done and what remains.

**What's missing today**: Compaction loses critical information. Session boundaries reset context. The agent in session N+1 doesn't know what session N learned about the codebase.

**Impact of structured knowledge**: A persistent, structured project model that captures relationships, completed work, and remaining tasks would eliminate the "new engineer on every shift" problem. This is what Anthropic's research on long-running agents identifies as the core challenge.

#### MOMENT 6: Multi-Agent Coordination (Orchestrator Context)

**What agents need**: The orchestrator needs a global model of the project to decompose tasks correctly.

**What's missing today**: Orchestrators decompose based on file boundaries or module names, not actual dependency relationships. This leads to:
- Two agents modifying the same interface from different directions
- Tasks assigned to agents without including dependency context
- Integration failures when worker outputs are combined

**Impact of structured knowledge**: A project graph showing components, their relationships, and boundaries would enable intelligent task decomposition that respects actual coupling. Workers would receive not just "modify file X" but "modify file X, knowing it has these consumers and these contracts."

### Summary: Value by Agent Lifecycle Phase

| Phase | Missing Knowledge | Impact of Adding It | Severity of Gap |
|-------|-------------------|---------------------|-----------------|
| Task Understanding | Component relationships, impact scope | Prevents wrong-scope changes | **CRITICAL** |
| Context Gathering | Dependency graph, cross-boundary links | Targeted vs. blind search | **CRITICAL** |
| Impact Analysis | Consumer mapping, test coverage | Prevents cascading breakage | **CRITICAL** |
| Planning | Architecture constraints, patterns | Better decomposition | HIGH |
| Implementation | Code conventions, existing patterns | Less refactoring needed | MEDIUM |
| Testing | Test-to-code mapping, coverage gaps | Focused verification | HIGH |
| Cross-Session | Persistent project model | Eliminates "amnesia" | **CRITICAL** |
| Multi-Agent Coordination | Project graph, coupling boundaries | Correct task decomposition | HIGH |

---

## Key Sources

- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Spotify: Context Engineering for Background Coding Agents](https://engineering.atspotify.com/2025/11/context-engineering-background-coding-agents-part-2)
- [Martin Fowler: Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
- [Addy Osmani: How to Write a Good Spec for AI Agents](https://addyosmani.com/blog/good-spec/)
- [GitHub: Spec-Driven Development with AI](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- [NxCode: Agentic Engineering Complete Guide](https://www.nxcode.io/resources/news/agentic-engineering-complete-guide-vibe-coding-ai-agents-2026)
- [Devin: Coding Agents 101](https://devin.ai/agents101)
- [CodeScene: Agentic AI Coding Best Practice Patterns](https://codescene.com/blog/agentic-ai-coding-best-practice-patterns-for-speed-with-quality)
- [How Cursor AI IDE Works](https://blog.sshh.io/p/how-cursor-ai-ide-works)
- [Aider Architecture Analysis](https://simranchawla.com/understanding-ai-coding-agents-through-aiders-architecture/)
- [OpenAI: Unrolling the Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
- [The Three Developer Loops Framework](https://itrevolution.com/articles/the-three-developer-loops-a-new-framework-for-ai-assisted-coding/)
- [Augment Code: 8 Failure Patterns of AI-Generated Code](https://www.augmentcode.com/guides/debugging-ai-generated-code-8-failure-patterns-and-fixes)
- [Stack Overflow: Are Bugs Inevitable with AI Coding Agents?](https://stackoverflow.blog/2026/01/28/are-bugs-and-incidents-inevitable-with-ai-coding-agents/)
- [The 70% Problem: Hard Truths About AI-Assisted Coding](https://addyo.substack.com/p/the-70-problem-hard-truths-about)
- [Why Your AI Coding Agent Keeps Making Bad Decisions](https://www.thegnar.com/blog/why-your-ai-coding-agent-keeps-making-bad-decisions-and-how-to-fix-it)
- [Cursor Agent Documentation](https://cursor.com/learn/agents)
- [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)
- [Cline AI Agent](https://cline.bot)
- [Arize: Orchestrator-Worker Agent Comparison](https://arize.com/blog/orchestrator-worker-agents-a-practical-comparison-of-common-agent-frameworks/)
- [Azure: AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
