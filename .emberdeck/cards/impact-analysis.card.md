---
{key: impact-analysis,summary: Agents know which cards are affected before code changes and regressions are detected,status: draft,type: intent,glossary: [card,codeLink,boundary,drift]}
---

## Problem & Goals
Before modifying code, agents must understand which design cards govern the affected area. Without pre-change analysis, agents silently violate cross-module contracts. The system must find affected cards through multiple mechanisms (direct links, boundary, transitive relations) and assess risk.

Goal: every code change to a card-covered area is preceded by impact analysis that surfaces all affected cards.

## User Scenarios

### P1: Agent checks impact before modifying a file
Given an agent is about to modify source files,
When preChangeCheck is called with file paths,
Then directly affected cards (codeLink), boundary-matched cards, and transitive dependents are returned with risk level.

### P2: Regression guard in CI
Given changed files are provided,
When regressionGuard is called,
Then the drifted ratio among affected cards is compared against the threshold,
And the guard passes or fails accordingly.

## Requirements
- R-001: preChangeCheck MUST find cards via 3 mechanisms: direct codeLink, boundary glob match, and BFS transitive relations.
- R-002: Risk level MUST be calculated from total affected cards and drifted ratio.
- R-003: regressionGuard MUST run fresh drift detection on affected cards (not rely on stale DB status).
- R-004: Uncovered files MUST be reported so agents can create new specs.
- R-005: preChangeCheck MUST attach the full project glossary for agent context.

## Success Criteria
- SC-001: 0 code changes to card-covered files without preChangeCheck being called first.
- SC-002: regressionGuard correctly fails when drifted ratio exceeds threshold.

## Scope & Constraints
- Covers: preChangeCheck, regressionGuard (impact.ts).
- Excludes: card CRUD, code link resolution mechanics, drift detection mechanics, glossary management.
- Assumes: gildash is available for link status computation.
