---
key: analysis/impact-and-aggregate/impact-and-regression
summary: >-
  preChangeCheck and regressionGuard implement risk_level scoring and CI
  threshold gating.
status: draft
type: spec
parent: analysis/impact-and-aggregate
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a list of repo-relative file paths (or a threshold for
        regression).
      derives: analysis/impact-and-aggregate#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        preChangeCheck returns risk_level (low / medium / high / critical)
        and per-card linkType (direct / transitive).
      keyword: MUST
      derives: analysis/impact-and-aggregate#G-001
    - id: POST-002
      guarantee: >-
        regressionGuard exits with code 2 when drifted ratio exceeds the
        configured threshold.
      keyword: SHALL
      derives: analysis/impact-and-aggregate#G-002
  invariants:
    - id: INV-001
      statement: risk_level is monotonic in affected_count and broken-link count.
      always_holds: per-call
  failures:
    - violation: A passed file path is not under the project root.
      behavior: >-
        preChangeCheck excludes the file silently; affected_cards reflects only
        known files.
---
