---
{key: policy-changelog-immutability,summary: Changelog entries are append-only and never edited or deleted except by FK CASCADE when the parent card is deleted,status: draft,type: decision,priority: medium,acceptance: [{id: ac-1,description: updateCard inserts changelog entries for every changed field before completing the transaction,verified: false},{id: ac-2,description: updateCardStatus inserts a changelog entry when oldStatus differs from newStatus,verified: false},{id: ac-3,description: No operation in the codebase updates or deletes changelog rows directly (only FK CASCADE on card delete),verified: false}],keywords: [changelog,card_changelog,getCardHistory,append-only,audit-trail],tags: [policy,audit,changelog],relations: [{type: depends-on,target: policy-cascade-propagation}],codeLinks: [{kind: variable,file: src/db/schema.ts,symbol: cardChangelog},{kind: function,file: src/ops/acceptance.ts,symbol: getCardHistory},{kind: function,file: src/ops/update.ts,symbol: updateCard},{kind: function,file: src/ops/update.ts,symbol: updateCardStatus}]}
---
## Policy

Every field change on a card (summary, type, priority, body, acceptance, relations, keywords, tags, codeLinks, status) inserts a new row into `card_changelog` with the old value, new value, timestamp, and `changedBy` (currently always `'agent'`). These rows are never updated or manually deleted.

## Structure

Each changelog entry records:
- `cardKey`: the card that changed
- `field`: which field changed
- `oldValue` / `newValue`: serialized as strings (JSON for complex fields, null for body changes)
- `changedAt`: ISO timestamp
- `changedBy`: actor identifier

## Lifecycle

Changelog rows are automatically deleted by FK CASCADE when the parent card is deleted. This is the only deletion path. There is no manual purge, TTL, or archival mechanism.

## What breaks if violated

- If changelog entries were editable, the audit trail would be untrustworthy.
- If changelog entries survived card deletion, orphan rows would accumulate with no parent.
- If changes were not recorded, `getCardHistory` and `generateContext` (which includes recent changes) would return incomplete data.

## Exclusions

- `body` changes record `oldValue: null, newValue: null` to avoid storing large diffs. Only the fact that the body changed is recorded.
- `syncCardFromFile` does NOT write changelog entries. Only explicit mutations through the ops layer are tracked.
- `verifyAcceptance` writes a changelog entry for acceptance changes when `changed > 0`.