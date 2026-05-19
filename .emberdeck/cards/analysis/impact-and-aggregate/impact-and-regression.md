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
        Caller passes a list of repo-relative file paths to preChangeCheck. For
        regressionGuard, the threshold is read from `ctx.regressionThreshold`
        (resolved at runtime construction); callers do not pass the threshold as
        an argument.
      derives: analysis/impact-and-aggregate#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        preChangeCheck returns riskLevel (low | medium | high | critical) and
        per-card linkType (direct | transitive). riskLevel is derived from a
        COMBINATION of: affected-card count, drift ratio of the affected cards,
        and fan-in of the touched files. A hot-file fan-in match contributes one
        tier of upward promotion (applied at most once per call).
      keyword: MUST
      derives: analysis/impact-and-aggregate#G-001
    - id: POST-002
      guarantee: >-
        regressionGuard exits with code 2 when the drifted ratio strictly
        exceeds `ctx.regressionThreshold`; exits 0 when the ratio is at or under
        threshold. The violating ratio is returned in the result data when exit
        is non-zero.
      keyword: SHALL
      derives: analysis/impact-and-aggregate#G-002
  invariants:
    - id: INV-001
      statement: >-
        riskLevel is monotonic upward under added affected cards, increased
        drift ratio, OR a fan-in match — but it is NOT a function of broken-link
        count in isolation; multiple inputs combine into the level. A hot-file
        fan-in match can only promote the level upward, never demote.
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
