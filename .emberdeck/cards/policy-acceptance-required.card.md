---
{key: policy-acceptance-required,summary: Every new card must have at least one acceptance criterion; cards without completion conditions cannot drive planning,status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: createCard throws CardValidationError when acceptance is undefined or empty array,verified: false},{id: ac-2,description: "updateCardStatus to 'implemented' emits warnings for unverified criteria but does not block",verified: false},{id: ac-3,description: verifyAcceptance throws when the card has no acceptance criteria at all,verified: false}],keywords: [acceptance,createCard,listUnverified,verifyAcceptance],tags: [policy,acceptance,spec-driven],codeLinks: [{kind: function,file: src/ops/create.ts,symbol: createCard},{kind: function,file: src/ops/acceptance.ts,symbol: verifyAcceptance},{kind: function,file: src/ops/acceptance.ts,symbol: listUnverified},{kind: function,file: src/ops/update.ts,symbol: updateCardStatus}]}
---
## Policy

`createCard` rejects input where `acceptance` is missing or empty with the message: "acceptance criteria are required — a card without completion conditions cannot drive planning."

## Rationale

Emberdeck exists to make spec-driven development traceable. A card without acceptance criteria is just a note — it cannot be verified, cannot participate in drift detection, and cannot gate implementation completion. Requiring at least one criterion at creation time ensures every card has a testable contract from birth.

## Status transition warning

When `updateCardStatus` transitions a card to `implemented`, it checks for unverified acceptance criteria and emits warnings (but does not block the transition). This is advisory, not a hard gate.

## What breaks if violated

- `listUnverified` returns nothing useful if cards have no criteria to verify.
- `checkDrift` cannot calculate `unverifiedRatio` for cards without acceptance criteria.
- The entire spec-first workflow degrades to a note-taking tool with no verification loop.

## Exclusions

- `updateCard` CAN set acceptance to null or empty (removing criteria from an existing card). The policy only applies at creation.
- `syncCardFromFile` does not enforce this — it trusts file content as-is.