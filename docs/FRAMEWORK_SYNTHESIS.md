> ⚠️ **Historical document.** Written when emberdeck shipped as an MCP server. emberdeck is now CLI-only (commit `c23851b`); MCP-specific paths and tool registrations in this file no longer apply. Design intent and analysis content remain valid.

# AI Agent Framework Quality-Enforcement Mechanisms: Comprehensive Synthesis

> 2026-03-19 | Emberdeck architectural decision reference

---

## Table of Contents

1. [How Each Framework Enforces Process Quality](#section-1-how-each-framework-enforces-process-quality)
2. [Patterns That Appear Across 3+ Frameworks](#section-2-patterns-that-appear-across-3-frameworks)
3. [What GSD Does That Others Don't](#section-3-what-gsd-does-that-others-dont)
4. [What Other Frameworks Do That GSD Doesn't](#section-4-what-other-frameworks-do-that-gsd-doesnt)
5. [Quality-Enforcing Mechanisms Ranked by Reliability](#section-5-quality-enforcing-mechanisms-ranked-by-reliability)
6. [Implications for a Design Knowledge System](#section-6-implications-for-a-design-knowledge-system)

---

## Section 1: How Each Framework Enforces Process Quality

For each framework, the following documents the **specific mechanisms** used to guarantee process quality WITHOUT relying on LLM compliance. Mechanisms are categorized into six dimensions.

---

### 1.1 LangGraph

**a) Gate Mechanisms**
- **Breakpoints/Interrupts**: Any node can be designated as a breakpoint via `.compile(interrupt_before=["node_name"])` or `interrupt_after`. Execution pauses, state is serialized, and cannot proceed until `Command(resume=...)` is issued with explicit approval. This is code-level enforcement -- the graph literally stops executing.
- **Conditional edges** (`add_conditional_edges()`): A Python function inspects state and returns the next node name. If the function returns `END`, the workflow terminates. The LLM has no ability to bypass this routing function.
- **Recursion limit**: Default 1,000 steps via `recursion_limit` parameter on `.compile()`. Hard stop -- raises exception when exceeded.

**b) Tool Access Control**
- **Per-node tool binding**: `ChatModel.bind_tools(tools)` controls exactly which tools are available to each node. Different nodes in the same graph can have different tool sets. The LLM cannot call tools that were not bound to its node.
- **Dynamic tool calling** (2025): Tools available to an agent can change at different points in a run based on graph state, enabling phase-dependent tool restrictions.

**c) State Persistence**
- **Automatic checkpointing**: Every state transition is persisted when a checkpointer is attached. Backends: PostgreSQL, SQLite, DynamoDB, in-memory. The `StateGraph` state is a `TypedDict` or Pydantic `BaseModel` with per-key reducer functions.
- **Thread-based sessions**: Each conversation is a thread with its own checkpoint history. State survives process crashes.
- **Long-term memory**: `BaseStore` stores JSON documents by namespace/key. API: `put()`, `get()`, `search()` with vector similarity.

**d) Structured Communication**
- **Typed state with reducers**: State keys have explicit types and reducer functions (e.g., `operator.add` for append, custom merge functions). Nodes return partial state updates that are mechanically merged, not freeform text.
- **`Command` class**: Combines state update + routing in a single atomic operation. `Command(update={"key": value}, goto="next_node")` ensures state mutation and routing happen together.
- **`Send` class**: Dynamic fan-out from conditional edges with per-destination typed state.

**e) Verification/Validation**
- **Pydantic state validation**: When state is defined as a Pydantic `BaseModel`, every state update is validated against the schema. Invalid updates raise `ValidationError`.
- **Graph compilation**: `.compile()` performs structural validation of the graph before any execution, catching missing edges, unreachable nodes, and type mismatches.

**f) Error Recovery**
- **Checkpoint-based restart**: On failure, execution resumes from the last successful superstep checkpoint. No state is lost.
- **Time-travel debugging**: Rewind to any prior state, modify, and re-execute from that point.

---

### 1.2 CrewAI

**a) Gate Mechanisms**
- **`human_input` parameter on Task**: When `human_input=True`, the task pauses after agent completion and waits for human review before the output is accepted. This is a hard gate -- downstream tasks cannot receive this task's output until human approval.
- **`guardrail` / `guardrails` parameter on Task**: Validation functions (or LLM-based validators) that execute sequentially on task output. Return `{"valid": True, "output": ...}` or `{"valid": False, "error": "..."}`. Failed validation triggers retry up to `max_retry_limit`.
- **`max_iter` parameter on Agent** (default 20): Hard cap on agent iteration loops. Prevents infinite reasoning cycles.
- **`max_execution_time` parameter**: Timeout in seconds per agent execution.

**b) Tool Access Control**
- **Agent-level tools**: Tools assigned to agent definition via `tools=[...]`.
- **Task-level tool override**: Tasks can specify `tools=[...]` that override agent defaults for that specific task. This enables phase-specific tool restriction.
- **`allow_delegation` parameter** (default False): When False, an agent cannot delegate work to other agents. This is an explicit opt-in, not a default.

**c) State Persistence**
- **Long-term memory** (SQLite3): Cross-session persistence of insights and evaluations.
- **Short-term memory** (ChromaDB + RAG): Current session context available across tasks within a `kickoff()`.
- **Entity memory**: RAG-based entity tracking (people, places, concepts).
- **Hierarchical scope system**: Filesystem-like tree (`/project/alpha`, `/agent/researcher`) with automatic inference or manual assignment.

**d) Structured Communication**
- **`output_pydantic` on Task**: Forces task output to be a validated Pydantic model instance. The framework validates the output against the schema before passing to downstream tasks.
- **`output_json` on Task**: Forces JSON-structured output with schema validation.
- **`context` parameter on Task**: Explicitly references other tasks whose outputs feed this task. The framework mechanically passes the output, not via freeform conversation.

**e) Verification/Validation**
- **Task guardrails**: Sequential validation functions on task output. Function-based (Python code) or LLM-based.
- **Composite memory scoring**: `semantic_weight(0.5) * similarity + recency_weight(0.3) * decay + importance_weight(0.2) * importance`. This is a formula, not LLM judgment.
- **Consolidation**: Deduplication at 0.85 similarity threshold, mechanically enforced.

**f) Error Recovery**
- **`max_iter` best-effort**: After hitting the iteration limit, agent produces its best answer and proceeds rather than crashing.
- **`respect_context_window=True`**: Auto-summarizes when approaching token limits, preventing context overflow crashes.

---

### 1.3 AutoGen

**a) Gate Mechanisms**
- **Termination conditions**: `max_round` on GroupChat, termination keywords in messages, custom `is_termination_msg` predicate functions. These are code-level checks, not LLM decisions.
- **`UserProxy` with `human_input_mode`**: `"ALWAYS"` requires human input every turn. `"TERMINATE"` requires human input at termination. Hard gates enforced by the framework.
- **`allowed_or_disallowed_speaker_transitions`**: Dictionary constraining which agents can follow which, enforced by the `GroupChatManager`. The LLM cannot bypass this transition table.

**b) Tool Access Control**
- **v0.4 `AssistantAgent(tools=[...])`**: Tools are explicitly passed to each agent instance. Different agents have different tool sets.
- **Docker code execution**: `DockerCommandLineCodeExecutor` sandboxes all LLM-generated code in Docker containers. The LLM cannot escape the container.

**c) State Persistence**
- **`save_state()` / `load_state()`** (v0.4): JSON-serializable agent and team state. Enables checkpointing across sessions.
- **Teachability (ChromaDB)**: Memos (input-output pairs) stored in persistent vector DB. Survives across sessions.

**d) Structured Communication**
- **Type-safe message classes** (v0.4): `TextMessage`, `MultiModalMessage` replace raw dicts. Messages have enforced types.
- **Carryover in Sequential Chat**: Summary from chat N becomes explicit context for chat N+1, mechanically assembled by the framework.

**e) Verification/Validation**
- **Speaker selection strategies**: `round_robin`, `random`, `manual` are deterministic. Only `auto` uses LLM judgment for speaker selection.
- **SocietyOfMindAgent**: `response_preparer` function extracts final answer from inner chat transcript -- a code function, not LLM interpretation.

**f) Error Recovery**
- **`save_state()` / `load_state()`**: State checkpointing enables crash recovery.
- **Docker container isolation**: Code execution failures are contained within containers.

---

### 1.4 OpenAI Agents SDK

**a) Gate Mechanisms**
- **Tripwires**: When any guardrail's `GuardrailFunctionOutput` has `tripwire_triggered=True`, execution halts immediately by raising `InputGuardrailTripwireTriggered` or `OutputGuardrailTripwireTriggered`. This is an exception -- the LLM cannot proceed.
- **`MaxTurnsExceeded` exception**: Hard limit on runner iterations. Raises Python exception when exceeded.
- **Tool Guardrails**: Wrap individual tool calls. Can `skip` the call, `replace` the output, or `tripwire` (halt). All enforced at the SDK level before/after tool execution.

**b) Tool Access Control**
- **Agent-level `tools` parameter**: Each agent has an explicit tool list. The LLM only sees schemas for tools in its `tools` list.
- **Handoff `is_enabled` parameter**: Conditional availability of handoffs. A disabled handoff does not appear in the LLM's tool list.
- **`tool_choice` parameter**: `auto`, `required`, `none`, or named string. `none` prevents any tool use. `required` forces tool use before text response.
- **`tool_use_behavior`**: `StopAtTools(["specific_tool"])` forces execution to stop when a specific tool is called, preventing the LLM from continuing.

**c) State Persistence**
- **9 session implementations**: SQLiteSession, RedisSession, SQLAlchemySession, DaprSession, EncryptedSession, etc. All manage conversation history persistence.
- **`RunContextWrapper`**: Mutable app state passed through the entire run. Not sent to the LLM. Application code controls what the LLM sees.

**d) Structured Communication**
- **`output_type` parameter**: Pydantic model, dataclass, or TypeAdapter. Forces structured output schema on LLM. The SDK validates output against the schema.
- **Handoff `on_handoff` callback with structured input**: Handoffs can carry typed escalation data (reason, priority, language), not freeform text.
- **`input_filter` on handoffs**: Code function that modifies conversation history passed to the receiving agent. Controls exactly what context transfers.

**e) Verification/Validation**
- **Input Guardrails**: Run on first agent input. Can run in `parallel` (concurrent with agent, latency optimization) or `blocking` mode (must pass before agent starts).
- **Output Guardrails**: Run on final output before returning to caller. Validated by Python code, not LLM judgment.
- **Structured output validation**: Pydantic validation on `output_type`.

**f) Error Recovery**
- **Durable execution integrations**: Temporal, Restate, DBOS for transient failure handling and long-running workflow recovery.
- **Session `pop_item()`**: Undo last exchange from session history.

---

### 1.5 Claude Agent SDK

**a) Gate Mechanisms**
- **Hooks system**: `PreToolUse` hook fires before every tool call. The hook can return a modified result, block the call, or inject alternative behavior. This runs in the application process, outside the agent's context window. The LLM cannot bypass hooks.
- **`Stop` hook**: Fires when the agent produces final output. Can validate the result and force continuation if validation fails.
- **Permission system**: `disallowed_tools` list completely blocks tools. The agent never sees blocked tool schemas. `allowed_tools` auto-approves listed tools. Uncovered tools are subject to `permission_mode`.
- **`max_turns` parameter**: Hard limit on agent loop iterations.
- **`max_budget_usd` parameter**: Cost ceiling that halts execution with `error_max_budget_usd` result subtype.

**b) Tool Access Control**
- **Three-layer permission model**: `allowed_tools` (auto-approve), `disallowed_tools` (block entirely), `permission_mode` (default/acceptEdits/plan/dontAsk/bypassPermissions).
- **Subagent tool scoping**: Each `AgentDefinition` specifies its own tool set. Subagents only have access to their declared tools.
- **Parallel vs sequential execution**: Read-only tools run concurrently; state-modifying tools (Edit, Write, Bash) run sequentially. This is enforced by the SDK, preventing race conditions.

**c) State Persistence**
- **Session resume/fork**: Sessions can be resumed with full prior context or forked into branches.
- **CLAUDE.md files**: Project-level and user-level persistent memory files that survive across sessions.
- **Auto-memory**: `~/.claude/projects/*/memory/MEMORY.md` automatically persisted.

**d) Structured Communication**
- **Message types**: `SystemMessage`, `AssistantMessage`, `UserMessage`, `StreamEvent`, `ResultMessage` -- all typed, not freeform.
- **`ResultMessage`**: Always the final message, containing `result_text`, `total_cost_usd`, `usage`, `num_turns`, `session_id`. Structured, not freeform.
- **Subagent isolation**: Subagent starts with fresh conversation. Only its final text response returns to parent as tool result. No context leakage.

**e) Verification/Validation**
- **`PostToolUse` hook**: Audit/validate tool results after execution, in application code.
- **Structured output retries**: `error_max_structured_output_retries` result subtype when output validation fails.

**f) Error Recovery**
- **Automatic compaction**: When context approaches limits, SDK summarizes older history. `PreCompact` hook allows archiving before compaction.
- **Session fork**: Branch from any point without losing original state.
- **Result subtypes**: `error_max_turns`, `error_max_budget_usd`, `error_during_execution`, `error_max_structured_output_retries` provide typed error categorization.

---

### 1.6 Google ADK

**a) Gate Mechanisms**
- **Callbacks with short-circuit**: `before_agent_callback`, `before_model_callback`, `before_tool_callback` -- returning a non-`None` value (e.g., an `LlmResponse`) short-circuits the step entirely. Code-level enforcement.
- **`LoopAgent` with `max_iterations`**: Hard iteration cap. Also, any sub-agent can yield `escalate=True` to break out of the loop.
- **`actions.transfer_to_agent` / `actions.escalate`**: Explicit delegation and escalation mechanics in `ToolContext`, not freeform LLM decision.

**b) Tool Access Control**
- **Agent-level `tools` parameter**: Each `LlmAgent` specifies its tool set.
- **`AgentTool`**: Wraps an agent as a tool for another agent. The parent's LLM calls the wrapped agent like a function, with defined input/output. The wrapped agent operates with its own tool set.
- **`include_contents` parameter**: `'none'` excludes prior conversation history from the agent's context, preventing information leakage.

**c) State Persistence**
- **Four-scope state system**: Prefix-based routing (`temp:`, none, `user:`, `app:`). `temp:` is never persisted. Session state persists with `DatabaseSessionService` or `VertexAiSessionService`. User/app scopes span sessions.
- **Versioned artifact system**: `ArtifactService` with automatic version numbering. `save_artifact()` returns version N. `load_artifact(version=N)` retrieves specific version. Backends: InMemory, GCS.
- **`MemoryService`**: Cross-session semantic memory. Ingests completed sessions, provides `search_memory(query)`.
- **Event-based state deltas**: State changes propagate via `actions.state_delta` in events, committed by Runner after yield.

**d) Structured Communication**
- **Event objects**: Atomic messages with `content` and `actions` (state_delta, artifact_delta). Not freeform text.
- **`output_key` on `LlmAgent`**: Agent response is auto-stored in `session.state[output_key]`. Downstream agents read from state, not from conversation history.
- **`output_schema` on `LlmAgent`**: Pydantic/Zod schema forcing structured LLM output.
- **`input_schema` on `LlmAgent`**: Schema for expected input, validated before agent execution.

**e) Verification/Validation**
- **`after_agent_callback`**: Code function to validate agent output after execution.
- **`after_tool_callback`**: Validate tool results after execution.
- **Built-in evaluation framework**: Test files (`*.test.json`), evalset files (`*.evalset.json`), metrics including `tool_trajectory_avg_score`, `hallucinations_v1`, `safety_v1`.

**f) Error Recovery**
- **Cooperative yield/resume**: State changes are only committed after the event carrying the `state_delta` is yielded and processed. If the agent crashes between yield points, uncommitted state is lost (not corrupted).
- **Session rewind**: Revert to previous invocation states.

---

### 1.7 Mastra AI

**a) Gate Mechanisms**
- **Workflow step schemas**: Each step created with `createStep()` requires explicit `inputSchema` / `outputSchema` (Zod). If the output does not match the schema, the step fails. This is code-level validation.
- **`maxSteps` on Agent** (default 5): Hard cap on sequential LLM calls.
- **Workflow control flow**: `.branch()` routes based on code-evaluated conditions (first true condition). `.dountil()` and `.dowhile()` use code-evaluated predicates. The LLM does not decide routing.
- **Suspend/resume**: Workflows can `suspend()` at any step, serializing state, and resume later with `resume()`.

**b) Tool Access Control**
- **Agent-level `tools` parameter**: Each agent specifies its tools.
- **`onDelegationStart` hook on supervisor**: Can modify the delegated prompt, limit steps, or **reject delegation entirely**. Code-level control over what subagents can do.
- **Memory isolation**: Subagents have isolated memory from the supervisor. Parallel work does not pollute shared context.

**c) State Persistence**
- **Working Memory**: Persistent structured user data across sessions (names, preferences, goals).
- **Observational Memory**: Background Observer/Reflector agents create compressed logs persisted across conversations.
- **Storage backends**: PostgreSQL, MongoDB, LibSQL.
- **Durable workflows**: Inngest-based durable execution for long-running workflows.

**d) Structured Communication**
- **Zod schemas on workflow steps**: Input/output schemas enforce typed data flow between steps.
- **Structured outputs on agents**: Zod or JSON Schema. `response.object` provides parsed, typed data.
- **`.map()` in workflows**: Explicit data transformation between steps.

**e) Verification/Validation**
- **Built-in evals**: Model-graded, rule-based, and statistical scorers. Normalized 0-1 scores stored in database. CI/CD integration.
- **Datasets and experiments**: Versioned test cases. Run items through targets and score outputs.

**f) Error Recovery**
- **Workflow suspend/resume**: State serialized at any step. Resume from exact point.
- **Durable Inngest execution**: Automatic retry with transient failure handling.

---

### 1.8 Pydantic AI

**a) Gate Mechanisms**
- **`ApprovalRequiredToolset`**: Gates tool execution on human approval. Deferred tool calls return `DeferredToolRequests` with call IDs. Code-level enforcement -- the tool literally does not execute until approval is received.
- **`UsageLimits`**: `response_tokens_limit`, `request_limit`, `tool_calls_limit`. Raises `UsageLimitExceeded` exception when exceeded. Hard stop.
- **Output validators**: `@agent.output_validator` decorator -- Python function that validates the agent's output. Can raise `ModelRetry` to force the agent to try again. Code-level validation.

**b) Tool Access Control**
- **`FilteredToolset`**: Excludes tools by predicate function. Dynamic, context-dependent filtering.
- **`PreparedToolset`**: Modifies tool definitions before each step. Tools can be added/removed based on current state.
- **`ApprovalRequiredToolset`**: Approval can depend on tool name, arguments, conversation history.
- **`toolsets` parameter**: Tools registered per-agent, not globally. Different agents have different tool access.

**c) State Persistence**
- **`ModelMessagesTypeAdapter`**: Serialization of message history to disk or database.
- **`pydantic-graph`** (separate library): State machines with typed edges, supporting long-running workflows (hours/days) with state persistence.
- **Durable execution**: Temporal, DBOS, Prefect integrations for transient failure recovery.

**d) Structured Communication**
- **`Agent[DependenciesType, OutputType]` generics**: Agent output type is part of the type signature. Static type checkers validate at write-time that outputs are used correctly. This is compile-time enforcement (mypy/pyright).
- **`RunContext[DepsType]`**: Typed dependency injection. System prompts, tools, and validators all receive typed dependencies.
- **7 structured output modes**: Tool Output, Native Output, Prompted Output, StructuredDict, Output functions, TextOutput, BinaryImage. All validated by Pydantic.

**e) Verification/Validation**
- **Pydantic schema validation on all tool arguments**: Every tool call's arguments are validated by Pydantic. Invalid arguments are sent back to the LLM with error messages for retry.
- **Output validators**: Python code that validates final output. `ModelRetry` forces retry with error message.
- **Type safety**: The framework's benchmark showed **23 bugs caught during development by type safety** that would have reached production in other frameworks.
- **`history_processors`**: Code functions that can filter/modify message history before each model request.

**f) Error Recovery**
- **Retry logic**: Configurable retry count at agent, tool, and output level. Validation errors trigger automatic retry with error context.
- **`FallbackModel`**: Sequential fallback on API errors, truncation, content filters, tool failures.

---

### 1.9 Vercel AI SDK

**a) Gate Mechanisms**
- **`needsApproval` on tools**: `true` (static) or `async (args) => boolean` (conditional). Tool execution is blocked until client sends `addToolApprovalResponse`. The tool literally cannot execute without approval.
- **`stopWhen` on `ToolLoopAgent`**: Code-defined stopping conditions (e.g., `stepCountIs(10)`). Hard stop.
- **`prepareStep`**: Code function that modifies model/tools/messages between steps. Can remove tools, change model, or alter context at each step.

**b) Tool Access Control**
- **Per-agent `tools` parameter**: Each `ToolLoopAgent` specifies its tool set.
- **`prepareStep` dynamic tool modification**: Tools can be added/removed between steps based on current state.

**c) State Persistence**
- **UIMessage persistence**: `UIMessage` is the recommended persistence format (v5+), containing full application state.
- **Durable Workflows** (Vercel Workflow/WDK): Pause/resume agents with built-in state management.

**d) Structured Communication**
- **Zod schema validation on tool parameters**: Tool definitions use Zod schemas. Invalid tool calls are rejected.
- **`generateObject`/`streamObject`**: Structured output with Zod, Valibot, or JSON Schema validation.
- **UIMessage/ModelMessage separation**: UIMessage = full application state. ModelMessage = stripped-down for model calls. Explicit boundary between application data and model data.

**e) Verification/Validation**
- **Zod validation**: All tool parameters and structured outputs validated by Zod schemas.
- **DevTools** (v6): Local inspector showing input/output, model config, token usage, timing for debugging.

**f) Error Recovery**
- **Durable Workflows**: Each tool execution becomes a retryable, observable step.

---

### 1.10 AWS Strands Agents

**a) Gate Mechanisms**
- **GraphBuilder with typed handoffs**: Graph pattern enforces typed handoff contracts between agents. Execution traces are recorded.
- **SOP (Standard Operating Procedures)**: Markdown-based workflows with parameterized inputs and constraint-based execution. While the LLM interprets SOPs, the parameterized structure provides more rigidity than freeform prompting.
- **Verification commands**: `verification_commands: [npm run lint, npm run test]` executed automatically after task completion.

**b) Tool Access Control**
- **Agent-level `tools` parameter**: Each agent specifies its tools via `tools=[...]`.
- **Graph pattern tool contracts**: `GraphBuilder` enforces which agents can access which tools within the graph topology.
- **Agent-as-Tool wrapping**: Specialized agents wrapped as callable tools for coordinator agents, with defined interfaces.

**c) State Persistence**
- **SessionManager**: `FileSessionManager` (local) and `S3SessionManager` (cloud). Automatic persistence via lifecycle hooks.
- **AgentCore Memory**: STM (conversation persistence) and LTM (three strategies: summary, user preference, semantic).

**d) Structured Communication**
- **SOP parameters**: Markdown SOPs with named parameters and constraints. More structured than freeform prompts.
- **Graph typed handoffs**: Typed data passed between agents in graph patterns.

**e) Verification/Validation**
- **Verification commands**: Automated shell commands (lint, test) run after task completion.
- **OpenTelemetry spans**: Every model inference, planner step, tool invocation, and agent handoff generates OTel spans.

**f) Error Recovery**
- **GSD-2 crash recovery**: Lock files + session forensics for crash recovery.
- **AgentCore long-running tasks**: Up to 8 hours, with managed recovery.

---

### 1.11 Semantic Kernel

**a) Gate Mechanisms**
- **Auto Function Invocation Filter**: Runs during auto function calling. Provides chat history, planned function list, iteration counters. Can terminate the loop early by setting `context.Terminate = true`. Code-level enforcement.
- **Prompt Render Filter**: Runs before prompt is sent to AI. Can modify, block, or redirect the prompt. Used for PII redaction, content safety, quality checks.
- **Function Invocation Filter**: Runs on every KernelFunction call. Can override results (caching), retry with alternative models, or block execution entirely.

**b) Tool Access Control**
- **Plugin architecture**: Functions are organized into plugins (groups). Only plugins registered in the Kernel are accessible. Different kernel configurations can expose different plugins.
- **`FunctionChoiceBehavior`**: `.Auto()`, `.Required()`, `.None()`. `.None()` prevents all function calling. `.Required()` forces tool use.
- **MCP import with selection**: When importing from MCP servers, you can select specific tools to expose.

**c) State Persistence**
- **`ChatHistory` object**: Stores user messages, assistant responses, tool calls, tool results.
- **Vector Store Connectors**: 17 connectors in C#, 14 in Python. Model-first approach with `[VectorStoreKey]`, `[VectorStoreData]`, `[VectorStoreVector]` annotations.

**d) Structured Communication**
- **`KernelFunction` with semantic descriptions**: Every function includes description strings that are mechanically injected into the LLM's tool schema.
- **OpenAPI plugin import**: API specifications provide structured schemas for all function parameters and return types.

**e) Verification/Validation**
- **Filter pipeline**: Three filter types compose a middleware pipeline. Each filter can inspect, modify, or block execution at its point.
- **Prompt Render Filter for content safety**: PII detection/redaction, semantic caching, content safety checks -- all in code, before the LLM sees the prompt.

**f) Error Recovery**
- **Function Invocation Filter retry**: Can catch exceptions and retry with alternative models or modified parameters.
- **Semantic caching via filters**: Cache hits bypass the LLM entirely, reducing failure surface.

---

### 1.12 Dify

**a) Gate Mechanisms**
- **IF/ELSE nodes in workflows**: Code-evaluated conditional branching in the visual workflow builder.
- **Iteration node with max iterations**: Configurable iteration limit (3-5 simple, 10-15 complex).
- **Parameter Extractor node**: Forces structured parameter extraction before agent execution.

**b) Tool Access Control**
- **Per-agent tool configuration**: Tools assigned in the visual agent configuration interface.
- **Workflow-as-Tool**: Entire workflows exposed as callable tools, with defined input/output schemas.

**c) State Persistence**
- **TokenBufferMemory**: Conversation memory for continuity.
- **Knowledge Base (RAG)**: Document ingestion, chunking, embedding, retrieval with persistent storage.

**d) Structured Communication**
- **Workflow node schemas**: Each node has defined input/output. Data flows through typed connections between nodes.
- **Jinja2 template nodes**: Structured text transformation between workflow steps.

**e) Verification/Validation**
- **Retrieval testing**: Query simulation in the Knowledge Base UI to verify RAG quality.
- **LLMOps dashboard**: Token usage, cost tracking, active users, message counts.

**f) Error Recovery**
- **Workflow restart**: Visual workflow builder allows re-running from specific nodes.

---

### 1.13 GSD (Get Shit Done)

**a) Gate Mechanisms**
- **Phase lifecycle**: discuss -> plan -> execute -> verify. Each phase produces specific file artifacts that must exist before the next phase begins. The orchestrator checks for artifact existence.
- **UAT verdict gating** (v2.32): Verification must produce `N-UAT.md` with pass/fail. Failed UAT triggers gap-closure loops.
- **Plan checker agent**: `gsd-plan-checker` verifies plans against 9 dimensions before execution begins. Read-only access prevents it from modifying plans.

**b) Tool Access Control**
- **12-agent role specialization**: Only `gsd-executor` has Edit permissions. Research agents have WebSearch/WebFetch. Plan checker is read-only. Tool access is hard-coded per agent role in the `allowed-tools` YAML frontmatter.
- **Workspace-write sandbox**: Some agents can only write to a sandbox workspace, not the main codebase.

**c) State Persistence**
- **File-based state machine**: All state in `.planning/` directory. `STATE.md` tracks current phase, decisions, blockers, metrics. YAML frontmatter provides structured metadata.
- **Per-task git commits**: Each executor task creates an atomic git commit. Rollback to any task boundary is possible.
- **Lock files + session forensics** (v2): Crash recovery via lock files and session state reconstruction.

**d) Structured Communication**
- **Indirect file artifacts**: Agents communicate through files (`N-CONTEXT.md`, `N-RESEARCH.md`, `N-0X-PLAN.md`, `N-0X-SUMMARY.md`, `N-UAT.md`), not direct messages. Each file has a defined schema.
- **Structured JSON from `gsd-tools` CLI**: Orchestrator uses JSON command output, not freeform text.
- **YAML frontmatter**: All state files use structured YAML frontmatter (metadata) + Markdown body (content).

**e) Verification/Validation**
- **`gsd-verifier` agent**: Post-execution goal-backward validation. Read-only access.
- **`gsd-integration-checker`**: Verifies integration quality at milestone completion. Read-only.
- **Verification commands**: `verification_commands: [npm run lint, npm run test]` in config.

**f) Error Recovery**
- **v2 crash recovery**: Lock files + session forensics.
- **Per-unit token/cost ledger** (v2): Budget tracking with `budget_ceiling` setting.
- **Gap-closure loops**: Failed UAT triggers re-execution of failed tasks.

---

### 1.14 BMAD Method

**a) Gate Mechanisms**
- **Four-phase artifact cycle**: Analysis -> Planning -> Solutioning -> Implementation. Each phase produces specific artifacts (PRD, user stories, architecture sketch) that must be completed before proceeding.
- **12+ specialized AI personas**: Each persona operates only within its domain.

**b) Tool Access Control**
- **Persona-based role separation**: PM, Architect, Developer, UX, Scrum Master each have defined scopes.

**c-f)** BMAD is primarily a methodology/prompt framework rather than a code-enforced system. Its enforcement comes from structured prompts and artifact requirements, not code-level gates.

---

### 1.15 Other Orchestration Tools

**Augment Code Intent**: Coordinator/Implementor/Verifier agent trio + living spec + isolated git worktrees. SOC 2 Type II certified. The verifier checks results against the living spec -- a code-enforced quality gate.

**Gas Town**: Mayor/Polecats/Witness/Deacon role hierarchy. Git worktree isolation per agent. 20-30 parallel agents managed via tmux.

**Roo Code**: 5 built-in modes (Code/Debug/Ask/Architect/Orchestrator). Each mode limits tool access to its role. Mode-based tool restriction is code-enforced.

**Google Conductor**: Track-based organization (spec -> plan -> phases -> subtasks). Implementation proceeds only after plan review. Automated review validates AI-generated code.

---

## Section 2: Patterns That Appear Across 3+ Frameworks

### Pattern 1: Per-Agent Tool Scoping

**Frameworks**: LangGraph (per-node `bind_tools`), CrewAI (agent-level and task-level tools), AutoGen (agent `tools` parameter), OpenAI Agents SDK (agent `tools`), Claude Agent SDK (subagent tool scoping, `allowed_tools`/`disallowed_tools`), Google ADK (agent `tools`), Mastra (`tools` on agent), Pydantic AI (`tools`/`toolsets`), Vercel AI SDK (agent `tools`), Strands (agent `tools`, graph tool contracts), Semantic Kernel (plugin registration per Kernel), GSD (per-agent `allowed-tools` YAML), Roo Code (mode-based tool restriction).

**Mechanism**: Each agent/node is given an explicit list of tools. The LLM's tool schema is constructed from this list. Tools not in the list do not appear in the schema and cannot be called.

**Why it works**: Prevents capability escalation. An agent designed for research cannot accidentally edit files because the Edit tool is not in its schema. This is a **schema-level constraint** -- the LLM literally does not know the tool exists, so it cannot call it. No amount of prompt engineering can bypass a missing schema entry.

**Failure mode prevented**: Agent using inappropriate tools for its role; executor agents accessing research tools; research agents modifying code.

---

### Pattern 2: Typed/Schema-Validated Output

**Frameworks**: CrewAI (`output_pydantic` on Task), OpenAI Agents SDK (`output_type` on Agent), Google ADK (`output_schema` on LlmAgent), Mastra (Zod schemas on workflow steps and structured output), Pydantic AI (`Agent[DepsType, OutputType]` generics, 7 output modes), Vercel AI SDK (`generateObject`/`streamObject` with Zod), Strands (graph typed handoffs).

**Mechanism**: Agent output is validated against a schema (Pydantic, Zod, JSON Schema). If the output does not conform, the framework either retries automatically or raises an error.

**Why it works**: LLMs produce freeform text by default. Schema validation forces structured output, making it mechanically parseable and verifiable. If an agent is supposed to output `{affected_cards: string[], risk_level: "low"|"medium"|"high"}`, freeform text like "I think there might be some affected cards" is rejected. The framework retries until the output matches the schema.

**Failure mode prevented**: LLM producing vague, unparseable, or incomplete output; downstream consumers receiving unexpected data shapes; silent data corruption in multi-step pipelines.

---

### Pattern 3: Checkpoint/State Persistence Outside LLM Context

**Frameworks**: LangGraph (automatic checkpointing to PostgreSQL/SQLite/DynamoDB), AutoGen (`save_state()`/`load_state()`), OpenAI Agents SDK (9 session implementations), Claude Agent SDK (session resume/fork, CLAUDE.md), Google ADK (four-scope state, SessionService, ArtifactService), Mastra (working memory, durable workflows), Strands (SessionManager, AgentCore Memory), Semantic Kernel (ChatHistory, vector store connectors).

**Mechanism**: Workflow state is persisted in an external store (database, file system, cloud service) independently of the LLM's context window. State survives context window resets, compaction, and process crashes.

**Why it works**: LLM context windows are volatile. They accumulate noise, get compacted (losing information), and have hard size limits. External state persistence means critical workflow data is never lost, regardless of what happens to the LLM's context.

**Failure mode prevented**: Context rot (progressive accuracy degradation as context fills); state loss on crash; information loss during compaction; inability to resume after failure.

---

### Pattern 4: Code-Level Routing (Not LLM-Decided)

**Frameworks**: LangGraph (conditional edges with Python routing functions), CrewAI (sequential/hierarchical process types), Google ADK (SequentialAgent, ParallelAgent, LoopAgent), Mastra (`.branch()`, `.dountil()`, `.dowhile()` with code predicates), Dify (IF/ELSE nodes), GSD (phase lifecycle with artifact checks), Semantic Kernel (sequential/concurrent orchestration patterns), Google Conductor (track-based progression).

**Mechanism**: Workflow transitions are determined by code functions that inspect state, not by LLM reasoning. The LLM processes data within a node/step, but the decision of what happens next is made by deterministic code.

**Why it works**: LLMs are unreliable routers. They may skip steps, repeat steps, or take unexpected paths. Code-level routing guarantees the workflow follows the designed sequence regardless of LLM behavior.

**Failure mode prevented**: LLM skipping verification steps; LLM looping in plan/execute without ever verifying; LLM taking shortcuts that bypass quality gates.

---

### Pattern 5: Middleware/Filter Pipeline

**Frameworks**: Semantic Kernel (Function Invocation Filter, Prompt Render Filter, Auto Function Invocation Filter), Claude Agent SDK (Hooks: PreToolUse, PostToolUse, UserPromptSubmit, Stop), OpenAI Agents SDK (Input/Output/Tool Guardrails), Google ADK (before/after agent/model/tool callbacks), Mastra (`onDelegationStart`, `onFinish`, `onStepFinish`), Pydantic AI (output validators, `WrapperToolset`).

**Mechanism**: Code functions execute at defined points in the agent loop (before/after tool calls, before/after model calls, at stop). These functions run in the application process, outside the LLM's awareness and context window. They can inspect, modify, or block execution.

**Why it works**: The LLM cannot bypass code that runs in the application process. Even if the LLM "decides" to skip a step, the middleware runs anyway because it is triggered by the execution framework, not by the LLM.

**Failure mode prevented**: LLM bypassing validation; LLM calling tools with unsafe parameters; LLM producing outputs that violate business rules; unchecked tool execution.

---

### Pattern 6: Hard Iteration/Budget Limits

**Frameworks**: LangGraph (`recursion_limit`, default 1000), CrewAI (`max_iter` default 20, `max_execution_time`), OpenAI Agents SDK (`MaxTurnsExceeded` exception), Claude Agent SDK (`max_turns`, `max_budget_usd`), Google ADK (`LoopAgent.max_iterations`), Mastra (`maxSteps` default 5), Pydantic AI (`UsageLimits`), Vercel AI SDK (`stopWhen`), Dify (configurable max iterations).

**Mechanism**: Hard ceiling on iterations, tokens, or cost. Exceeding the limit raises an exception or produces an error result. The framework enforces this regardless of LLM behavior.

**Why it works**: LLMs can enter infinite loops, especially in multi-agent systems. Hard limits are a safety net that prevents runaway execution. The LLM cannot "decide" to continue past the limit.

**Failure mode prevented**: Infinite agent loops; runaway token costs; agents that never converge; denial-of-wallet attacks.

---

### Pattern 7: Human-in-the-Loop Approval Gates

**Frameworks**: LangGraph (breakpoints with state serialization), CrewAI (`human_input=True` on Task), AutoGen (`human_input_mode="ALWAYS"` on UserProxy), OpenAI Agents SDK (`approve_tool()`/`reject_tool()`), Claude Agent SDK (`AskUserQuestion` tool, permission system), Google ADK (tool confirmation flow), Vercel AI SDK (`needsApproval` on tools), Pydantic AI (`ApprovalRequiredToolset`).

**Mechanism**: Execution pauses at defined points and waits for human approval before proceeding. The framework serializes state and blocks until approval is received.

**Why it works**: Mechanical pause. The LLM cannot bypass the approval gate because execution is suspended by the framework. No amount of LLM reasoning can resume execution without the approval signal.

**Failure mode prevented**: Unreviewed code changes; unauthorized destructive operations; agents making irreversible decisions without human oversight.

---

### Pattern 8: Agent-as-Tool (Controlled Delegation)

**Frameworks**: OpenAI Agents SDK (`agent.as_tool()`), Google ADK (`AgentTool`), Strands (Agent-as-Tool pattern), Mastra (subagents), Claude Agent SDK (`Agent` tool for subagent spawning), Semantic Kernel (agents within orchestration patterns).

**Mechanism**: An agent is wrapped as a tool callable by another agent. The manager agent retains control -- the sub-agent executes as a function call and returns its result. The manager does not lose its place in the workflow.

**Why it works**: Prevents uncontrolled delegation cascades. The manager agent calls the sub-agent like a function, receives the result, and continues. The sub-agent cannot hijack the workflow or communicate with other agents directly.

**Failure mode prevented**: Delegation cascades; loss of orchestrator context; sub-agent taking over the workflow; uncoordinated parallel execution.

---

## Section 3: What GSD Does That Others Don't

### 3.1 The Thin Orchestrator Pattern

GSD's orchestrator stays at 15-30% context usage by loading only file paths (not file contents) and using structured JSON from the `gsd-tools` CLI. This leaves 70-85% of the context window for spawned sub-agents.

**No other framework implements this pattern.** Most frameworks either:
- Give the orchestrator full context (LangGraph, CrewAI, AutoGen) -- leading to context rot
- Use a simple while-loop with accumulating context (Claude Agent SDK, OpenAI Agents SDK) -- leading to compaction-based information loss

GSD's approach is unique because it treats context budget as an explicitly managed resource at the orchestration level.

### 3.2 File-Based State Machine

All GSD state persists in `.planning/` as Markdown + YAML frontmatter files:
- `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `config.json`
- Per-phase: `N-CONTEXT.md`, `N-RESEARCH.md`, `N-0X-PLAN.md`, `N-0X-SUMMARY.md`, `N-UAT.md`

**Why this is unique**: Every other framework stores state in databases, in-memory stores, or serialized objects. GSD's file-based state is:
1. **Human-readable**: Anyone can inspect `.planning/STATE.md` to see current workflow state
2. **Git-trackable**: State changes are committed alongside code changes
3. **IDE-native**: Any AI coding agent (Claude Code, Cursor, Gemini CLI) can read/write these files through its standard file tools
4. **Environment-agnostic**: No database, no special runtime, no framework-specific API. Just files.

### 3.3 Phase Lifecycle (discuss -> plan -> execute -> verify)

GSD enforces a four-phase lifecycle for every unit of work:

1. **Discuss**: `AskUserQuestion()` captures human decisions. Produces `N-CONTEXT.md`.
2. **Plan**: Research agents gather information, planners create executable plans. Produces `N-RESEARCH.md`, `N-0X-PLAN.md`.
3. **Execute**: Executor agents implement tasks. Each task creates an atomic git commit. Produces `N-0X-SUMMARY.md`.
4. **Verify**: Verifier and integration-checker agents validate. Produces `N-UAT.md`. Failed UAT triggers gap-closure loops.

**What makes this different**: Agent frameworks offer execution patterns (sequential, parallel, supervisor) but not development lifecycle phases. GSD is the only system that structures work around the software development lifecycle itself, not just agent orchestration patterns.

### 3.4 12-Agent Role Specialization with Tool Restrictions

| Agent | Can Edit Code | Can Search Web | Can Write Plans |
|-------|:---:|:---:|:---:|
| gsd-executor | Yes | No | No |
| gsd-planner | No | No | Yes |
| gsd-plan-checker | No | No | No (read-only) |
| gsd-verifier | No | No | No (read-only) |
| gsd-phase-researcher | No | Yes | No |

**Only `gsd-executor` can edit code.** This is a hard constraint in the YAML frontmatter `allowed-tools` field. The planner cannot accidentally make code changes. The verifier cannot "fix" issues it finds.

**Why this matters**: In most frameworks, multi-agent means multiple LLMs with potentially overlapping tool access. GSD's strict tool partitioning means role confusion is impossible at the tooling level.

### 3.5 Context Rot Prevention via Sub-Agent Spawning

GSD spawns fresh sub-agents for each task. Each sub-agent starts with a clean context window, receives only the specific task context, and returns only its result. The orchestrator's context never grows because sub-agent conversations are isolated.

GSD-2 formalizes this: "A task must fit in one context window. If it can't, it's two tasks."

**Comparison**: Claude Agent SDK supports subagents with fresh context, but does not enforce the "one task = one context window" rule. LangGraph nodes share state but not isolated contexts. CrewAI agents share memory within a crew.

### 3.6 Artifact-Based Inter-Agent Communication

Agents communicate exclusively through file artifacts. The planner writes `N-0X-PLAN.md`. The executor reads `N-0X-PLAN.md` and writes `N-0X-SUMMARY.md`. The verifier reads `N-0X-SUMMARY.md`.

**No direct agent-to-agent messaging exists in GSD.** This is fundamentally different from every agent framework (which uses message passing, shared state, or tool-call chaining).

**Advantages**:
- Every inter-agent communication is persisted as a file (auditable, git-trackable)
- No message format compatibility issues between agents
- Any AI agent runtime can participate (just read/write files)
- Communication survives process crashes (files persist)

---

## Section 4: What Other Frameworks Do That GSD Doesn't

### 4.1 Type Safety

**Who has it**: Pydantic AI (`Agent[DepsType, OutputType]` generics with static type checking), Mastra (Zod schemas throughout), Vercel AI SDK (TypeScript type inference), Google ADK (Pydantic/Zod schemas for input/output), LangGraph (Pydantic BaseModel state).

**What GSD lacks**: GSD uses Markdown + YAML frontmatter. There is no type system governing state transitions, artifact schemas, or inter-agent communication. If a planner writes malformed YAML frontmatter, the executor may fail silently or produce incorrect behavior.

### 4.2 Persistent Memory Across Sessions

**Who has it**: LangGraph (BaseStore with namespace/key/vector search), CrewAI (long-term SQLite + entity memory + composite scoring), Google ADK (MemoryService cross-session), Strands (AgentCore LTM with three strategies), Semantic Kernel (vector store connectors), Mastra (observational memory, working memory).

**What GSD lacks**: GSD's memory is entirely file-based within `.planning/`. There is no semantic search, no vector storage, no entity tracking. Past project decisions are available only if the planner happens to reference the relevant file.

### 4.3 Schema Validation

**Who has it**: Pydantic AI (Pydantic validation on all tool args and outputs), OpenAI Agents SDK (`output_type` Pydantic validation), Google ADK (`input_schema`/`output_schema`), Mastra (Zod schemas on workflow steps), Vercel AI SDK (Zod tool parameters), CrewAI (`output_pydantic` on tasks).

**What GSD lacks**: GSD has no schema validation on artifacts. A plan file must follow a specific structure, but this is enforced only by prompt instructions, not by a schema validator.

### 4.4 Graph-Based Dependency Analysis

**Who has it**: LangGraph (directed graph with Pregel-based execution), Pydantic AI (`pydantic-graph` state machines), Strands (GraphBuilder), Google ADK (agent hierarchy tree), Mastra (workflow DAG).

**What GSD lacks**: GSD uses sequential phases and parallel task execution within phases, but has no formal dependency graph between tasks or between artifacts. Task ordering is determined by the planner, not by declared dependencies.

### 4.5 Deployment/Scaling

**Who has it**: Google ADK (Vertex AI Agent Engine with auto-scaling, VPC-SC, HIPAA), LangGraph (LangSmith Deployment with cloud/BYOC/self-hosted), Strands (AgentCore with Lambda/Fargate/EC2), Semantic Kernel (Azure integration), Mastra (Cloudflare Workers/Vercel/Netlify deployers), Vercel AI SDK (Vercel platform with Durable Workflows).

**What GSD lacks**: GSD is a development tool, not a deployment platform. It runs inside an AI coding agent (Claude Code, Gemini CLI). There is no server deployment, no scaling, no production runtime.

### 4.6 Protocol Support (MCP, A2A)

**Who has it**: Claude Agent SDK (MCP native, 10,000+ servers), Google ADK (MCP + A2A native), Pydantic AI (MCP + A2A via FastA2A), Semantic Kernel (MCP bidirectional), OpenAI Agents SDK (MCP native, HostedMCPTool), Mastra (MCP bidirectional), Strands (MCP + A2A), Vercel AI SDK (MCP support).

**What GSD lacks**: GSD v1 operates via slash commands and file I/O. GSD v2 uses the Pi SDK. Neither version speaks MCP or A2A. GSD agents cannot be consumed by external systems through standardized protocols.

### 4.7 Structured Guardrails

**Who has it**: OpenAI Agents SDK (Input/Output/Tool Guardrails with tripwires), CrewAI (task guardrails with retry), Pydantic AI (output validators with ModelRetry), Semantic Kernel (three-level filter pipeline), Claude Agent SDK (Hooks system).

**What GSD lacks**: GSD's quality control relies on the `gsd-plan-checker` and `gsd-verifier` agents, which are LLM-based validators. There are no code-level guardrails that mechanically validate output before it proceeds.

### 4.8 Real-Time Streaming

**Who has it**: LangGraph (7 streaming modes), Vercel AI SDK (SSE streaming with React hooks), Claude Agent SDK (StreamEvent), Google ADK (SSE + Gemini Live bidirectional), Mastra (streaming execution events).

**What GSD lacks**: GSD operates in batch mode. Each agent runs to completion and produces file artifacts. There is no real-time streaming of intermediate results.

---

## Section 5: Quality-Enforcing Mechanisms Ranked by Reliability

### Level 1: Impossible to Bypass (Code-Level Enforcement)

These mechanisms operate in the application process, outside the LLM's awareness. The LLM cannot even attempt to bypass them.

| Mechanism | Frameworks | How It Works |
|-----------|-----------|--------------|
| **Tool schema exclusion** | All 12 frameworks + GSD | Tools not in the agent's tool list do not appear in the LLM's schema. The LLM cannot call what it cannot see. |
| **Typed output schema validation** | Pydantic AI, OpenAI Agents SDK, Google ADK, CrewAI, Mastra, Vercel AI SDK | Output is validated by Pydantic/Zod against a declared schema. Invalid output is rejected and retried. |
| **Pre/Post tool hooks** | Claude Agent SDK (PreToolUse/PostToolUse), Semantic Kernel (filters), OpenAI Agents SDK (tool guardrails), Google ADK (before/after callbacks) | Code functions execute before/after every tool call, in the application process. Can block, modify, or override. |
| **Hard iteration/budget limits** | All 12 frameworks + GSD | `max_turns`, `max_iter`, `max_budget_usd`, `recursion_limit`, `UsageLimits`. Raises exceptions when exceeded. |
| **Execution pause with state serialization** | LangGraph (breakpoints), OpenAI Agents SDK (approval gates), Claude Agent SDK (permission system), Vercel AI SDK (needsApproval), Pydantic AI (ApprovalRequiredToolset), Google ADK (tool confirmation) | Framework suspends execution and waits for external signal. The LLM's process is literally paused. |
| **Docker/sandbox isolation for code execution** | AutoGen (DockerCommandLineCodeExecutor), CrewAI (`code_execution_mode="safe"`), Claude Agent SDK (Bash tool sandboxing) | Generated code runs in isolated containers. Cannot access host resources. |
| **Middleware filter pipeline** | Semantic Kernel (3 filter types), Claude Agent SDK (Hooks), OpenAI Agents SDK (Guardrails) | Every request/response passes through code-level filters that can inspect, modify, block. |

### Level 2: Very Hard to Bypass (Requires Specific Tool Access)

These mechanisms require the LLM to have access to specific tools to circumvent, and those tools are typically not available.

| Mechanism | Frameworks | How It Works |
|-----------|-----------|--------------|
| **File-based state with restricted write access** | GSD (only executor can write to codebase), Augment Code Intent (git worktree isolation), Gas Town (git worktree per agent) | State files exist on disk. Only agents with write tools can modify them. Read-only agents (verifiers, checkers) cannot corrupt state. |
| **Deterministic code-level routing** | LangGraph (conditional edges), Google ADK (SequentialAgent/ParallelAgent/LoopAgent), Mastra (branch/dountil/dowhile), Dify (IF/ELSE nodes) | Workflow transitions are determined by code functions, not LLM reasoning. The LLM processes data within a step but cannot control what step comes next. |
| **Subagent context isolation** | Claude Agent SDK (subagent fresh context), GSD (per-task fresh context), Google ADK (ParallelAgent context branching) | Sub-agents start with clean contexts. They cannot access or corrupt the parent's context. Results are passed back as structured tool responses. |
| **Artifact versioning** | Google ADK (ArtifactService with version numbers), GSD (per-task git commits) | Every artifact change creates a new version. Previous versions are immutable. Rollback is always possible. |
| **Typed inter-agent communication** | Google ADK (Event with state_delta), Pydantic AI (typed delegation), OpenAI Agents SDK (structured handoff input) | Agents pass typed data structures, not freeform text. Schema violations are caught at the communication boundary. |

### Level 3: Moderately Reliable (Depends on Orchestrator Cooperation)

These mechanisms work as long as the orchestrating code/framework is correctly implemented and maintained.

| Mechanism | Frameworks | How It Works |
|-----------|-----------|--------------|
| **Phase lifecycle enforcement** | GSD (discuss->plan->execute->verify), BMAD (Analysis->Planning->Solutioning->Implementation), Google Conductor (spec->plan->phases->subtasks) | Phases proceed in order with artifact gates. Effectiveness depends on the orchestrator correctly checking for phase artifacts. |
| **Verification commands** | GSD (`verification_commands: [npm run lint, npm run test]`), Strands (verification commands in SOP) | Automated tests/linters run after execution. Only catches issues that tests cover. |
| **Session/conversation persistence** | OpenAI Agents SDK (9 session implementations), Google ADK (SessionService), Strands (SessionManager) | State persists across sessions. Effectiveness depends on correct session management code. |
| **Memory scoring and consolidation** | CrewAI (composite scoring formula), Mastra (observational memory via background agents) | Automated memory management. Quality depends on scoring weights and consolidation thresholds. |
| **SOP execution** | Strands (Markdown SOPs with parameters) | Structured natural language workflows. More rigid than freeform prompts, but still interpreted by the LLM. |

### Level 4: Unreliable (Depends on LLM Compliance / Prompting)

These mechanisms work only if the LLM "chooses" to comply. They can be bypassed by LLM reasoning, model updates, or prompt injection.

| Mechanism | Frameworks | How It Works |
|-----------|-----------|--------------|
| **System prompt instructions** | All frameworks | "Always check design cards before modifying code." The LLM may or may not follow this instruction. |
| **Role/persona prompting** | CrewAI (role/goal/backstory), BMAD (12+ personas), SuperClaude (cognitive personas) | Agent is told it is a "Senior Data Analyst." The LLM may drift from this role during extended conversations. |
| **CLAUDE.md / AGENTS.md rules** | Claude Agent SDK (CLAUDE.md), OpenAI Agents SDK (AGENTS.md) | Project-level instructions loaded into context. Subject to context window limits and compaction. |
| **LLM-based plan validation** | GSD (gsd-plan-checker), BMAD (persona review) | An LLM validates another LLM's output. The validator LLM may hallucinate approvals or miss issues. |
| **Natural language workflow** (unpatterned) | Strands SOPs, GSD phase instructions | The LLM interprets Markdown instructions. May skip steps, misinterpret constraints, or take shortcuts. |
| **Voluntary tool calling** | All MCP-based integrations without enforcement | "You should call emberdeck_pre_change_check before modifying code." The LLM may decide to skip this step. |

---

## Section 6: Implications for a Design Knowledge System

### The Core Problem Restated

Emberdeck currently operates as an MCP tool package. Agents must voluntarily call Emberdeck tools. Prompting ("always check design cards before modifying code") is unreliable across environments. The question is: what combination of mechanisms from the researched frameworks would achieve mechanical enforcement?

### 6.1 The Enforcement Gap

Looking at the reliability ranking in Section 5, Emberdeck's current enforcement sits at **Level 4 (Unreliable)** -- it depends entirely on LLM compliance via system prompts and CLAUDE.md instructions.

To achieve meaningful enforcement, Emberdeck needs to move mechanisms up to **Level 1 or Level 2**.

### 6.2 Specific Mechanism Recommendations

#### Mechanism A: Pre-Tool Hook Injection (Level 1)

**Inspiration**: Claude Agent SDK `PreToolUse` hooks, Semantic Kernel's Auto Function Invocation Filter, OpenAI Agents SDK's Tool Guardrails.

**Implementation**: In environments that support hooks/filters (Claude Code, Cursor with custom extensions, any framework with middleware), register a `PreToolUse` hook that:
1. Intercepts calls to `Edit`, `Write`, `Bash` (any state-modifying tool)
2. Extracts the target file path and code symbols being modified
3. Calls Emberdeck's `emberdeck_pre_change_check` and `emberdeck_find_affected_cards` mechanically
4. Injects the affected design cards into the tool call context
5. Optionally blocks the tool call if design violations are detected

**Reliability**: Level 1 -- the hook runs in the application process. The LLM cannot bypass it because it fires automatically before every state-modifying tool call.

**Cross-environment feasibility**: Claude Code supports hooks natively. Cursor and VS Code support extension-level interception. Gemini CLI supports hooks via configuration. For environments without hook support, this mechanism is unavailable.

#### Mechanism B: Schema-Validated Design Contracts (Level 1)

**Inspiration**: Pydantic AI's typed output validation, Google ADK's `output_schema`, CrewAI's `output_pydantic`.

**Implementation**: Define design contracts as schemas:
```typescript
interface ChangeProposal {
  files_modified: string[];
  symbols_affected: string[];
  design_cards_checked: string[];  // card keys
  cascading_impacts: { card_key: string; impact: string }[];
  violations: string[];  // empty = no violations
}
```

Any code modification tool must produce a `ChangeProposal` that is validated against this schema. If `design_cards_checked` is empty or `violations` is non-empty, the modification is rejected by the validation layer.

**Reliability**: Level 1 -- schema validation is mechanical. The LLM must produce conforming output or the modification fails.

**Cross-environment feasibility**: Requires a wrapper layer around code modification tools. Works in any environment that supports tool wrapping or middleware.

#### Mechanism C: File-System-Based Design Gates (Level 2)

**Inspiration**: GSD's file-based state machine, artifact-gated phase transitions.

**Implementation**: Create a `.emberdeck/change-log/` directory. Before any code modification:
1. The agent must create a change proposal file: `.emberdeck/change-log/YYYY-MM-DD-HHMMSS-proposal.md`
2. This file must contain YAML frontmatter with: `symbols_affected`, `cards_checked`, `impact_assessment`
3. The modification tool checks for the existence of a proposal file less than N minutes old
4. If no valid proposal exists, the modification tool fails with an error message explaining the requirement

**Reliability**: Level 2 -- requires the modification tool to check for the file, which is code-level enforcement if Emberdeck provides a wrapped tool. Falls to Level 3 if the agent can use unwrapped tools.

**Cross-environment feasibility**: Works in any environment because it uses files. The key requirement is that the code modification tool checks for the proposal file.

#### Mechanism D: Post-Modification Drift Detection (Level 1)

**Inspiration**: GSD's `gsd-verifier` and `gsd-integration-checker`, Google ADK's `after_tool_callback`, Claude Agent SDK's `PostToolUse` hook.

**Implementation**: Register a `PostToolUse` hook on `Edit`, `Write`, `Bash`:
1. After every code modification, extract the modified file paths
2. Call `emberdeck_check_drift` to compare current code against design knowledge
3. Call `emberdeck_resolve_code_links` to verify symbol links are still valid
4. If drift is detected, inject a warning into the agent's context
5. Optionally auto-create a card update task via `emberdeck_update_card`

**Reliability**: Level 1 -- runs automatically after every modification. The LLM cannot prevent the drift check.

**Cross-environment feasibility**: Same as Mechanism A. Depends on hook support.

#### Mechanism E: MCP Tool Wrapping (Level 1 in supporting environments)

**Inspiration**: Pydantic AI's `WrapperToolset`, `PreparedToolset`; Semantic Kernel's MCP export/import.

**Implementation**: Instead of exposing Emberdeck as a separate MCP server, expose it as a **wrapper** around code modification tools:
1. Emberdeck provides an MCP server that re-exports the standard file modification tools (`Edit`, `Write`, `Bash`)
2. These re-exported tools internally call `emberdeck_pre_change_check` before executing the actual modification
3. The re-exported tools call `emberdeck_check_drift` after execution
4. The agent sees only the wrapped tools, not the raw tools

**Reliability**: Level 1 -- if the agent can only access Emberdeck-wrapped tools, every modification is automatically checked. The LLM cannot use raw modification tools because they are not in its tool schema.

**Cross-environment feasibility**: Requires the environment to allow MCP server configuration. Works in Claude Code, Cursor, Gemini CLI, Codex, and any MCP-supporting environment. This is the most portable approach.

#### Mechanism F: Git Hook Integration (Level 1)

**Inspiration**: GSD's per-task atomic git commits and verification commands.

**Implementation**: A git pre-commit hook that:
1. Identifies modified files and symbols
2. Calls Emberdeck's drift detection
3. Rejects the commit if design contracts are violated
4. Outputs the list of affected cards and required updates

**Reliability**: Level 1 -- git hooks are enforced by git itself. The LLM cannot bypass a pre-commit hook unless it has access to `git commit --no-verify`, which can be blocked via tool restrictions.

**Cross-environment feasibility**: Works in every environment that uses git. Framework-agnostic. Does not depend on AI coding environment features.

### 6.3 Recommended Combination (Defense in Depth)

The most reliable approach combines multiple mechanisms at different levels:

| Layer | Mechanism | Reliability | Coverage |
|-------|-----------|-------------|----------|
| **1. MCP Tool Wrapping** (Mechanism E) | Emberdeck wraps modification tools | Level 1 | All MCP-supporting environments |
| **2. Git Pre-Commit Hook** (Mechanism F) | Drift detection on commit | Level 1 | All git-based workflows |
| **3. Pre/Post Tool Hooks** (Mechanisms A+D) | Intercept modifications in real-time | Level 1 | Claude Code, environments with hook support |
| **4. Schema-Validated Contracts** (Mechanism B) | Typed change proposals | Level 1 | Environments supporting structured output |
| **5. File-Based Gates** (Mechanism C) | Change proposal files | Level 2 | Fallback for environments without hook support |

**Key insight**: The git pre-commit hook (Layer 2) is the universal safety net. Even if all other mechanisms fail (wrong MCP config, hooks not set up, environment limitations), the git hook catches violations before they are committed. This is the one mechanism that works regardless of AI coding environment.

### 6.4 What Emberdeck Should NOT Do

Based on the analysis of all 12+ frameworks:

1. **Do not rely on prompting**: System prompts, CLAUDE.md instructions, and "always check cards" rules are Level 4 (unreliable). They should exist as guidance, not as enforcement.

2. **Do not build a full orchestration framework**: GSD, BMAD, and Google Conductor already exist for SDLC orchestration. Emberdeck should integrate with them, not compete. The unique value is design knowledge, not workflow management.

3. **Do not require specific AI environments**: The most impactful approach uses MCP (universal) + git hooks (universal). Environment-specific hooks (Claude Code, Cursor) are bonuses, not requirements.

4. **Do not store enforcement state in LLM context**: LLM context is volatile (compaction, window limits, context rot). Enforcement state (which cards were checked, which violations were found) must live outside the context window -- in files, databases, or git metadata.

### 6.5 Architecture Summary

```
Layer 1 (Universal): Git pre-commit hook
  - Runs on every commit
  - Calls emberdeck_check_drift, emberdeck_resolve_code_links
  - Blocks commits with design contract violations
  - Works in every AI coding environment

Layer 2 (MCP-supporting environments): Tool wrapping MCP server
  - Re-exports Edit/Write/Bash with pre/post Emberdeck checks
  - Agent sees only wrapped tools
  - Works in Claude Code, Cursor, Gemini CLI, Codex, etc.

Layer 3 (Hook-supporting environments): Pre/PostToolUse hooks
  - Real-time interception of modifications
  - Injects design context before changes
  - Detects drift after changes
  - Works in Claude Code, environments with middleware support

Layer 4 (Guidance): CLAUDE.md / system prompt instructions
  - "Check emberdeck cards before modifying code"
  - Unreliable but provides LLM-friendly context
  - Documents the workflow for human developers
```

This layered approach ensures that design knowledge enforcement degrades gracefully:
- Best case: All four layers active (triple enforcement + guidance)
- Good case: MCP wrapping + git hooks (double enforcement)
- Minimum viable: Git hooks only (single enforcement, but universal)
- Current state: Prompting only (unreliable)

### 6.6 Key Technical Decisions

1. **Emberdeck should provide a "wrapping MCP server"** that re-exports standard file modification tools with built-in design checks. This is the highest-leverage, most portable enforcement mechanism.

2. **Emberdeck should provide a git hook package** (`emberdeck-git-hooks` or integrated into the CLI) that performs drift detection on every commit.

3. **Emberdeck should define a `ChangeProposal` schema** (similar to how Pydantic AI and Google ADK define output schemas) that captures the design impact of every modification.

4. **Enforcement state should be stored in `.emberdeck/`** files, not in LLM context. This follows GSD's file-based state pattern and ensures persistence across context windows, sessions, and environments.

5. **Emberdeck should integrate with GSD/BMAD/Conductor** at the phase level -- providing design knowledge checks as part of their verify phase, not replacing their orchestration.

---

## Appendix: Framework Quick Reference

| Framework | Language | Key Enforcement Mechanism | MCP | Stars |
|-----------|---------|--------------------------|-----|-------|
| LangGraph | Python, TS | Graph-based state machine with checkpointing | Yes | ~27k |
| CrewAI | Python | Role-based agents with task guardrails | Yes | ~46.5k |
| AutoGen | Python, .NET | Conversation patterns with speaker transitions | Yes | ~55.8k |
| OpenAI Agents SDK | Python, TS | Tripwire guardrails, structured handoffs | Yes | ~20k |
| Claude Agent SDK | Python, TS | PreToolUse hooks, permission system | Yes (native) | ~5.6k |
| Google ADK | Python, TS, Go, Java | Callbacks with short-circuit, four-scope state | Yes + A2A | ~18.4k |
| Mastra | TypeScript | Zod-validated workflow steps, supervisor hooks | Yes (bidirectional) | ~22k |
| Pydantic AI | Python | Generic type safety, composable toolsets | Yes + A2A | ~15.6k |
| Vercel AI SDK | TypeScript | needsApproval tools, prepareStep | Yes | ~22.8k |
| Strands Agents | Python, TS (preview) | SOPs, GraphBuilder, verification commands | Yes + A2A | ~5.3k |
| Semantic Kernel | C#, Python, Java | Three-level filter pipeline, DI | Yes (bidirectional) | ~27.5k |
| Dify | Python (platform) | Visual workflow IF/ELSE, iteration limits | No | ~131k |
| GSD | Markdown/CLI | File-based state, 12 agents with tool restrictions | No | ~32k |

---

*This document synthesizes research from 12 agent framework analyses, GSD deep dive, and AI orchestration landscape research conducted 2026-03-19.*
