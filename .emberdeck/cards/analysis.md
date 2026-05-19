---
key: analysis
summary: >-
  Drift detection, impact, regression, interactions, and the analyze aggregate
  over cards plus code state.
status: active
type: domain
glossary:
  - drift
domain:
  overview: >-
    Owns analytical reads on top of card and code state. Detects the two drift
    types in scope today — `broken_link` (a cached code_link points at a symbol
    gildash can no longer resolve) and `glossary_broken` (a card declares a
    glossary word that the glossary no longer carries) — reports them as derived
    facts without mutating card status, computes impact and riskLevel for
    proposed file changes, evaluates regression thresholds, surfaces interaction
    conflicts between cards that share code, and aggregates the overall analyze
    health view consumed by onboarding and dashboards.
  scope: >-
    IN: checkDrift, checkInteractions, preChangeCheck, regressionGuard, analyze,
    drift classification as a derived (never stored) fact, riskLevel
    computation, shared-symbol conflict detection.


    OUT: mutating card status (status changes are user-declared via
    card-lifecycle), applying drift fixes (delegated to card-lifecycle plus
    code-binding), CLI presentation.
  cross_domain_dependencies:
    - domain: code-binding
      relationship: consumes link-resolution outputs to classify drift.
    - domain: card-storage
      relationship: reads card state through repositories to compute aggregates.
---
