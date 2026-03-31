---
{key: drift-detection,summary: Drifted cards are detected and transitioned automatically with no silent drift,status: draft,type: intent,glossary: [card,drift,codeLink,boundary,gildash]}
---

## Problem & Goals
Code changes can break the alignment between spec cards and source code. Without automatic detection, agents work with stale design knowledge and silently violate contracts. The system must detect drift through multiple mechanisms and transition affected cards.

Goal: every form of code-spec divergence is detected within one check cycle.

## User Scenarios

### P1: Code link breaks after symbol rename
Given a spec card has active codeLinks,
When a linked symbol is renamed or deleted,
Then checkDrift detects broken_link drift and auto-transitions the card to drifted status.

### P2: Boundary files disappear
Given a spec card has boundary patterns matching source files,
When all matching files are deleted,
Then checkDrift detects boundary_inactive drift.

### P2: Glossary term removed
Given a card declares a glossary word,
When that word is removed from the project glossary,
Then checkDrift detects glossary_broken drift.

### P3: Symbol modified in boundary scope
Given an active card has boundary patterns,
When symbols in boundary-matched files change after the card's last update,
Then checkDrift detects symbol_changed drift with change details.

## Requirements
- R-001: System MUST detect drift via 4 mechanisms: broken_link, boundary_inactive, symbol_changed, glossary_broken.
- R-002: Auto-transition from active to drifted MUST update both DB and file atomically.
- R-003: If auto-transition file write fails, DB MUST be reverted to previous state.
- R-004: Draft cards MUST be excluded from drift analysis.
- R-005: When gildash is transiently unavailable, broken links MUST NOT trigger auto-transition (false positive prevention).

## Success Criteria
- SC-001: 0 cases of silent drift (drift exists but card remains active after a check cycle).
- SC-002: 0 false-positive drift transitions when gildash is temporarily unavailable.

## Scope & Constraints
- Covers: checkDrift, checkInteractions (context.ts), drift mechanisms, auto-transition.
- Excludes: card CRUD operations, code link creation, glossary management, impact analysis.
- Assumes: gildash provides getSymbolChanges for symbol_changed detection.
