---
{key: drift-lifecycle,summary: "Card status state machine, auto-transition policy, gildash-optional degradation",status: active,type: intent,parent: emberdeck,tags: [core,design],relations: [emberdeck,card-model]}
---
## Why
Code evolves independently of cards. Without drift detection, agents trust stale cards and make decisions based on outdated constraints. The drift lifecycle ensures cards that no longer match code reality are visibly marked, so agents know to verify before trusting.

## Status state machine
- **draft**: Card created, code not yet written. Excluded from drift analysis entirely.
- **active**: Card and code are in sync. Subject to drift detection.
- **drifted**: Code has diverged from card. Agent must verify before trusting.

## Transition rules
- draft → active: Activation guard must pass (spec: ≥1 codeLink that resolves, boundary matches files)
- active → drifted: Automatic when drift detected (broken link, inactive boundary, symbol changed)
- drifted → active: Manual re-activation after fixing drift cause
- Never automatic upward transitions — only downward (active→drifted) happens without user action

## Auto-transition policy
- checkDrift with autoTransition=true (default) modifies card status in DB and file
- Analyses wanting read-only checks (e.g. regressionGuard) must pass autoTransition=false
- Only active → drifted transitions happen automatically; draft cards are never touched

## Gildash-optional degradation
When gildash unavailable (projectRoot not set or init fails):
- Activation guard: codeLink count checked (≥1), symbol resolution skipped
- Drift detection: all three drift types skipped (broken_link, boundary_inactive, symbol_changed)
- Coverage analysis: returns 0 symbols (no index to check)
- Impact analysis: codeLink file matching works, boundary matching works, symbol matching skipped
- All other operations (CRUD, sync, query, relations) work fully without gildash