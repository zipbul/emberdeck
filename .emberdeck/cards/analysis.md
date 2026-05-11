---
key: analysis
summary: >-
  Drift detection, impact, regression, interactions, and the analyze
  aggregate over cards plus code state.
status: draft
type: domain
glossary:
  - drift
domain:
  overview: >
    Owns analytical reads on top of card and code state. Detects the two
    drift types in scope today — `broken_link` (a cached code_link points
    at a symbol gildash can no longer resolve) and `glossary_broken` (a
    card declares a glossary word that the glossary no longer carries) —
    drives automatic active-to-drifted transitions when configured,
    computes impact and risk_level for proposed file changes, evaluates
    regression thresholds, surfaces interaction conflicts between cards
    that share code, and aggregates the overall analyze health view
    consumed by onboarding and dashboards.
  scope: >
    IN: checkDrift, checkInteractions, preChangeCheck, regressionGuard,
    analyze, drift classification, automatic status transitions on drift,
    risk_level computation, shared-symbol conflict detection.

    OUT: applying drift fixes (delegated to card-lifecycle plus
    code-binding), CLI presentation.
  cross_domain_dependencies:
    - domain: code-binding
      relationship: consumes link-resolution outputs to classify drift.
    - domain: card-storage
      relationship: reads card state through repositories to compute aggregates.
---
