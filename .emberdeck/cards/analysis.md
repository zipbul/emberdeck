---
key: analysis
summary: >-
  Drift detection, impact, regression, interactions, and the analyze aggregate
  over cards plus code state.
status: draft
type: domain
glossary:
  - drift
domain:
  overview: >
    Owns analytical reads on top of card and code state. Detects six drift types

    (broken_link, boundary_inactive, symbol_changed, heritage_uncovered,
    pattern_violation,

    glossary_broken), drives automatic active-to-drifted status transitions when
    configured,

    computes impact and risk_level for proposed file changes, evaluates
    regression thresholds,

    surfaces interaction conflicts between cards that share code, and aggregates
    the overall

    analyze health view consumed by onboarding and dashboards.
  scope: >
    IN: checkDrift, checkInteractions, preChangeCheck, regressionGuard, analyze,
    drift type

    classification, automatic status transitions on drift, risk_level
    computation, shared-symbol

    conflict detection.


    OUT: applying drift fixes (delegated to card-lifecycle plus code-binding),
    CLI presentation.
  cross_domain_dependencies:
    - domain: code-binding
      relationship: >-
        consumes link-resolution and pattern evaluation outputs to classify
        drift.
    - domain: card-storage
      relationship: reads card state through repositories to compute aggregates.
---
