---
key: analysis/impact-and-aggregate/impact-and-regression
summary: >-
  preChangeCheck and regressionGuard implement riskLevel scoring with hot-file
  fan-in promotion and CI threshold gating.
status: active
type: spec
parent: analysis/impact-and-aggregate
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a list of repo-relative file paths (or, for
        regressionGuard, a threshold in [0,1]).
      derives: analysis/impact-and-aggregate#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        preChangeCheck returns riskLevel (low | medium | high | critical) and
        per-card linkType (direct | transitive). Fan-in promotion bumps
        riskLevel one tier when any touched file has fan-in at or above a
        hot-file threshold; the promotion is applied at most once per call.
      keyword: MUST
      derives: analysis/impact-and-aggregate#G-001
    - id: POST-002
      guarantee: >-
        regressionGuard exits with code 2 when the drifted ratio strictly
        exceeds the configured threshold; exits 0 when ratio is at or under
        threshold. The violating ratio is returned in the result data when exit
        is non-zero.
      keyword: SHALL
      derives: analysis/impact-and-aggregate#G-002
  invariants:
    - id: INV-001
      statement: >-
        riskLevel is monotonic in affectedCount and broken-link count; a
        hot-file fan-in match can only promote the level upward, never demote.
      always_holds: per-call
  failures:
    - violation: >-
        A passed file path is not under the project root or is excluded by
        configured ignorePatterns.
      behavior: >-
        preChangeCheck excludes the file silently; affectedCards reflects only
        the remaining known files and newUncoveredFiles reflects the post-ignore
        set.
---
