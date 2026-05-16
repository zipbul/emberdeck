---
key: single-process-invocation
summary: >-
  ed CLI is invoked in a single-process model; cross-process concurrency is not
  guaranteed.
status: active
type: principle
glossary:
  - single-process
principle:
  statement: >-
    ed CLI commands SHALL be invoked in a single-process model; concurrent
    invocations across processes MUST NOT be relied upon for transactional or
    compensation safety.
  rationale: >-
    Cross-process locking is intentionally not implemented in this system; the
    reserved cross-process lock primitive remains inert. The compensation logic
    in safe-write assumes the single-process invocation model and would not
    provide adequate guarantees under cross-process contention. Treating
    single-process as a contract surface lets workflows above it (CI, scripts)
    avoid bolt-on retry frameworks while keeping recovery semantics simple.
  applies_to:
    - '*'
  enforcement: warning
---
