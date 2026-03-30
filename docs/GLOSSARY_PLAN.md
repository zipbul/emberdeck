# Glossary Plan

## 1. What

Emberdeck glossary = project vocabulary. Word + definition pairs.
Cards declare which glossary words they use via required `glossary` field.
System validates declarations mechanically.

**Not in scope:** aliases, code symbol mapping, NLP.

## 2. Why

Emberdeck covers 5 knowledge axes. The 6th is missing:

| Axis | Question | Solved by |
|------|----------|-----------|
| WHAT | What is the design? | spec cards |
| WHY | Why this way? | intent cards |
| WHERE | Where in code? | codeLinks |
| HOW | How connected? | relations |
| CHANGED? | Has it drifted? | check_drift |
| **CALLED?** | **What do we call it?** | **glossary** |

Without shared vocabulary, each agent session invents its own names.
Research shows: anonymizing identifiers drops LLM code search from 70% to 17%.
Misleading names are worse than no names.

## 3. Enforcement levels

### Mechanical (emberdeck code, 100% deterministic)

| ID | What | When | How |
|----|------|------|-----|
| M1 | glossary field required + non-empty | create/update card | validation error |
| M2 | declared words must exist in glossary.yaml | create/update card | exact match |
| M3 | no duplicate declarations | create/update card | Set comparison |
| M4 | glossary word deleted → referencing cards drift | remove_glossary → check_drift | status transition |
| M5 | glossary word renamed → card fields bulk-updated | rename_glossary | DB transaction |
| M6 | body contains undeclared glossary word | create/update/validate | word-boundary regex (case-insensitive) → warning |
| M7 | declared word absent from body/summary | create/update/validate | word-boundary regex (case-insensitive) → warning |
| M8 | pre_change_check includes full glossary | pre_change_check | auto-attach |
| M9 | validate_cards cross-checks all cards | validate_cards | batch scan |

### Skill-enforced (prompt/context, agent behavior guidance)

| ID | Problem | Why not mechanical | Skill instruction |
|----|---------|-------------------|-------------------|
| S1 | Synonym usage ("Task" vs "Job") | non-glossary word indistinguishable from general language | "Do not use domain terms that are absent from the glossary" |
| S2 | Code symbol naming inconsistent with glossary | code naming is outside emberdeck scope | "Use glossary terms when naming code symbols" |
| S3 | New domain concept not registered | detecting "new concept" requires semantic judgment | "Call define_glossary before introducing a new domain concept" |

### Limitations (outside emberdeck scope)

| ID | Problem | Why not solvable here |
|----|---------|----------------------|
| L1 | Poor glossary definition quality | definition quality requires semantic judgment |
| L2 | Same word used with different meanings across cards | cross-card semantic comparison requires NLP |
| L3 | Card body modified with wrong terms in context | contextually correct term selection requires semantic judgment |

These require separate engineering beyond this package.

## 4. Glossary storage

### File

`.emberdeck/glossary.yaml` — single YAML file, git-committed.

```yaml
- word: Job
  definition: A unit of work submitted by a user to the processing pipeline

- word: Worker
  definition: A container-level process that executes a Job
```

**No DB.** Glossary is small (< 500 entries = < 50KB). File is read and parsed in memory on demand. No sync problem, no migration for glossary itself.

### Schema per entry

```typescript
interface GlossaryEntry {
  word: string        // canonical name, unique, case-sensitive
  definition: string  // what it means in this project
}
```

2 fields. No aliases. No code references.

### Validation limits

```typescript
const GLOSSARY_LIMITS = {
  WORD_MAX: 100,            // max chars per word
  DEFINITION_MAX: 1000,     // max chars per definition
  MAX_ENTRIES: 500,          // max total glossary entries
} as const;
```

### File lifecycle

- First `define_glossary` call creates the file.
- All reads on nonexistent file return empty glossary.
- File is never deleted by the system. Empty file = empty glossary.

### Concurrency

Global glossary lock (mutex). Same `Promise`-chaining pattern as `withCardLock` in `src/ops/safe.ts`, but keyed on the glossary file path instead of a card key.

**Scope:** The lock covers the entire write operation — including DB transactions when present (e.g., `rename_glossary` updates card rows in a DB transaction, then writes glossary.yaml, all within a single lock acquisition). Read-only operations (`lookup_glossary`) do not acquire the lock.

**Why global:** Unlike `withCardLock` (per-key), the glossary is a single shared file. All write operations (`define`, `remove`, `rename`) must serialize through the same lock to prevent read-modify-write races.

## 5. Card schema change

### New required field

Add `glossary: string[]` to `CardFrontmatter` in `src/card/types.ts`:

```typescript
interface CardFrontmatter {
  key: string
  summary: string
  status: CardStatus
  type: CardType
  glossary: string[]          // REQUIRED. Non-empty. Each must exist in glossary.yaml.
  parent?: string
  boundary?: string[]
  relations?: string[]
  codeLinks?: CodeLink[]
  tags?: string[]
}
```

**Constraints:**
- Non-empty: `glossary.length >= 1`
- No duplicates: all entries unique
- Existence: every entry must match a `word` in glossary.yaml (case-sensitive exact match)

### DB schema change

Add column to `card` table. New migration file `drizzle/0001_glossary.sql`:

```sql
ALTER TABLE card ADD COLUMN glossary_json TEXT NOT NULL DEFAULT '[]';
```

Add to Drizzle schema in `src/db/schema.ts`:

```typescript
glossaryJson: text('glossary_json').notNull().default('[]'),
```

### Markdown serialization

In `src/card/markdown.ts`, `glossary` is serialized/parsed as a YAML array in frontmatter:

```yaml
---
key: job-queue-spec
type: spec
summary: Job queue processing contracts
glossary: [Job, Worker, Priority]
---
```

### FTS

Glossary words are NOT added to `card_fts`. They are structured metadata, not searchable text.

## 6. New MCP tools (4)

All tools in `src/mcp/tools.ts`. Operations in new file `src/ops/glossary.ts`.
Glossary file I/O in new file `src/glossary/io.ts`.

### 6.1 emberdeck_define_glossary

**Description:** "Define or update words in the project glossary. Use when new domain concepts are introduced or existing definitions need refinement. Agent must show proposed words and definitions to the user and get confirmation before calling."

**Input:**
```typescript
z.object({
  entries: z.array(z.object({
    word: z.string().min(1).max(100),
    definition: z.string().min(1).max(1000),
  })).min(1).max(50),
}).strict()
```

**Behavior:**
1. Validate all entries against limits. If any entry fails validation, reject the entire call (all-or-nothing).
2. Acquire glossary lock.
3. Read glossary.yaml.
4. Check that total entries after upsert would not exceed MAX_ENTRIES.
5. For each entry: if word exists, update definition (upsert). If new, append.
6. Write glossary.yaml. Release lock.
7. Return `{ results: Array<{ action: 'created' | 'updated', word, definition }> }`.

### 6.2 emberdeck_lookup_glossary

**Description:** "Look up a word in the project glossary, or list all entries. Use when encountering an unfamiliar domain concept in code or cards, or when starting a session to understand the project vocabulary."

**Input:**
```typescript
z.object({
  word: z.string().optional(),  // omit to list all entries
}).strict()
```

**Behavior:**
1. Read glossary.yaml.
2. If `word` provided: case-sensitive exact match. Return the entry (or "not found").
3. If `word` omitted: return all entries.

> **Design note:** Lookup is case-sensitive to match card glossary validation (case-sensitive exact match). If lookup were case-insensitive, agents would find "Job" by searching "job" but then fail validation when using the input "job" instead of the canonical "Job".

### 6.3 emberdeck_remove_glossary

**Description:** "Remove a word from the project glossary. Use when a domain concept is eliminated from the project. Cards referencing this word will become drifted."

**Input:**
```typescript
z.object({
  word: z.string().min(1),
}).strict()
```

**Behavior:**
1. Acquire glossary lock.
2. Read glossary.yaml.
3. If word not found: error (release lock).
4. Remove entry. Write file. Release lock.
5. Scan all cards' glossary_json for the removed word. Return affected card keys as warning.
6. Do NOT auto-transition cards. `check_drift` handles that.

### 6.4 emberdeck_rename_glossary

**Description:** "Rename a word in the project glossary. Updates the glossary file and all card glossary fields that reference the old word. Card bodies are NOT updated (manual). Use when a domain concept is rebranded."

**Input:**
```typescript
z.object({
  oldWord: z.string().min(1),
  newWord: z.string().min(1).max(100),
  definition: z.string().min(1).max(1000).optional(),  // update definition too, if provided
}).strict()
```

**Behavior:**
1. Acquire glossary lock.
2. Read glossary.yaml.
3. Validate oldWord exists. Validate newWord is not already in glossary.
4. Collect affected cards: all cards with oldWord in glossary_json.
5. DB transaction: for each affected card:
   - Replace oldWord with newWord in glossary_json.
   - Update DB row.
   - Log changelog entry (field: "glossary", old: oldWord, new: newWord).
6. Rename entry in glossary.yaml (update word, optionally update definition). Write file. Release lock.
7. Rewrite affected card .md files with updated frontmatter (best-effort).
8. If any file write fails: log warning. Return failed card keys so agent can retry.
9. Return `{ renamedFrom, renamedTo, cardsUpdated: number, fileWriteFailures: string[] }`.

**Atomicity:** The glossary lock covers steps 1–6 (DB transaction + file write). No other glossary operation can interleave. DB transaction failure → nothing changed (lock released). glossary.yaml write failure after DB commit → `validate_cards` detects content-mismatch between DB (new word) and card files (old word). Agent resolves by calling `export_card_to_file` on affected cards (rewrites file from DB state). Do NOT use `sync_card_from_file` — that syncs file → DB and would undo the rename.

## 7. Existing tool modifications (8)

### 7.1 create_card / bulk_create_cards

**File:** `src/ops/create.ts`, `src/ops/bulk-create.ts`

**Change:** Add glossary validation to `validateCardInput()` in `src/card/validation.ts`:

```typescript
// In validateCardInput:
if (!input.glossary || input.glossary.length === 0) {
  throw new CardValidationError('glossary field is required and must contain at least one entry');
}
if (new Set(input.glossary).size !== input.glossary.length) {
  throw new CardValidationError('glossary field must not contain duplicates');
}
// Validate each word exists in glossary.yaml
const glossary = readGlossary(ctx);
for (const word of input.glossary) {
  if (!glossary.find(e => e.word === word)) {
    throw new CardValidationError(`glossary word "${word}" not found in glossary.yaml`);
  }
}
```

**Body cross-validation:** After validation passes, scan body + summary for glossary words. Return warnings for undeclared usage (M6) and phantom declarations (M7) in the response. Do not block creation.

**MCP input schema change:** Add `glossary` to create_card and bulk_create_cards input schemas:

```typescript
glossary: z.array(z.string().min(1).max(100)).min(1),
```

### 7.2 update_card

**File:** `src/ops/update.ts`

**Change:** When `glossary` field is provided in update, validate existence and non-empty. When any field is updated, do NOT re-validate existing glossary (allow updates to drifted cards without forcing glossary fix).

**Body cross-validation:** When body or glossary is updated, scan body + summary against glossary field. Return warnings for M6/M7 in the response.

**MCP input schema change:** Add optional `glossary` field:

```typescript
glossary: z.array(z.string().min(1).max(100)).min(1).optional(),
```

### 7.3 validate_cards

**File:** `src/ops/sync.ts`

**Change:** Add glossary cross-validation:

1. Read glossary.yaml.
2. For each card: check every entry in glossary_json exists in glossary.yaml.
3. Broken references: report as `glossary-broken` warning type.
4. Unused glossary entries: glossary words not referenced by any card. Report as `glossary-unused` info.
5. Body cross-validation: for each card, scan body + summary against glossary. Report `glossary-undeclared-usage` and `glossary-phantom-declaration` warnings.

**Content-mismatch extended:** Add `glossary_json` to the existing content-mismatch check in `validateCards`. When DB `glossary_json` differs from the file frontmatter's `glossary` field, report `content-mismatch` warning. This catches rename_glossary partial failures where DB was updated but card file write failed.

New warning types added to `ValidateResult`:

```typescript
type ValidateWarningType =
  | 'stale-db-row' | 'orphan-file' | 'key-mismatch'
  | 'broken-parent' | 'content-mismatch'
  | 'glossary-broken'              // card references nonexistent glossary word
  | 'glossary-unused'              // glossary word not referenced by any card
  | 'glossary-undeclared-usage'    // card body contains glossary word not in card's glossary field
  | 'glossary-phantom-declaration' // card declares glossary word absent from body/summary
  ;
```

### 7.4 check_drift

**File:** `src/ops/context.ts`

**Change:** Add 4th drift type: `glossary_broken`.

When checking a card:
1. Read glossary.yaml.
2. For each word in card's glossary field: check it exists.
3. If any missing: drift detected, type = `glossary_broken`.
4. If card is active and `autoTransition` is true: transition to drifted.

```typescript
type DriftType = 'broken_link' | 'boundary_inactive' | 'symbol_changed' | 'glossary_broken';
```

### 7.5 regression_guard

**File:** `src/ops/impact.ts`

**Change:** Include glossary-broken cards in drift count. `regressionGuard` calls `checkDrift` internally, so if check_drift detects glossary_broken, it's automatically included in the regression count.

Verify: regressionGuard iterates drifted cards returned by checkDrift. If glossary_broken is a new DriftType, it flows through. May need no code change beyond check_drift — confirm during implementation.

### 7.6 pre_change_check

**File:** `src/ops/impact.ts`

**Change:** Append full glossary and per-card body cross-validation to response.

```typescript
// In preChangeCheck return value:
{
  ...existingFields,
  glossary: readGlossary(ctx),  // full glossary entries
  glossaryWarnings: bodyCrossValidation(card),  // M6/M7 warnings for this card
}
```

Glossary is small (< 50KB for 500 entries). Always include full list. No filtering needed.

### 7.7 analyze

**File:** `src/ops/analyze.ts`

**Change:** Add glossary section to analysis result.

```typescript
// In analyze return value:
{
  ...existingFields,
  glossary: {
    totalWords: number,
    unusedWords: string[],       // words not referenced by any card
    entries: GlossaryEntry[],    // full glossary
  },
}
```

### 7.8 sync_card_from_file / bulk_sync_cards

**File:** `src/ops/sync.ts`

**Change:** When syncing a card from file, parse the `glossary` field from frontmatter. Store in DB as glossary_json. Validate glossary words exist in glossary.yaml. If validation fails: sync the card but report warning (don't block sync — file is source of truth).

### 7.9 Read path response changes

The following tools return card data from DB. After adding `glossary_json` column, each must parse `glossary_json` and include `glossary: string[]` in the response.

| Tool | File | Change |
|------|------|--------|
| `get_card` | `src/ops/query.ts` | Include `glossary` in CardFile frontmatter |
| `get_cards` | `src/ops/query.ts` | Same |
| `list_cards` | `src/ops/query.ts` | Same |
| `get_card_context` | `src/ops/query.ts` | Same |
| `get_card_tree` | `src/ops/query.ts` | Same |
| `export_card_to_file` | `src/ops/sync.ts` | Include `glossary` in frontmatter construction (line ~470) |

**Implementation:** Where `CardFile.frontmatter` is constructed from a DB row, add:

```typescript
...(row.glossaryJson && row.glossaryJson !== '[]'
  ? { glossary: JSON.parse(row.glossaryJson) }
  : {}),
```

### 7.10 onboarding_summary

**File:** `src/ops/analyze.ts`

**Change:** Include glossary state in `OnboardingSummary`:

```typescript
{
  ...existingFields,
  glossary: {
    totalWords: number,         // total glossary entries
    exists: boolean,            // whether glossary.yaml exists
  },
}
```

This lets a fresh agent session immediately see whether glossary onboarding is needed.

### 7.11 suggest_card_scope

**File:** `src/ops/spec-sync.ts`

**Change:** When suggesting scope for a new card, include recommended glossary words from the full glossary that appear in the suggested boundary files' symbols and paths:

```typescript
{
  ...existingFields,
  suggestedGlossary: string[],  // glossary words relevant to this scope
}
```

**Detection:** Run `buildGlossaryMatcher` against the symbol names and file paths in the suggested scope. Return matching glossary words.

## 8. Validation integration

### In validateCardInput (src/card/validation.ts)

New validation function:

```typescript
export function validateGlossaryField(
  glossary: string[],
  glossaryEntries: GlossaryEntry[],
): void {
  if (glossary.length === 0) {
    throw new CardValidationError('glossary must contain at least one entry');
  }
  if (glossary.length > LIMITS.ARRAY_MAX) {
    throw new CardValidationError(`glossary exceeds max ${LIMITS.ARRAY_MAX} entries`);
  }
  const seen = new Set<string>();
  for (const word of glossary) {
    if (word.length === 0 || word.length > GLOSSARY_LIMITS.WORD_MAX) {
      throw new CardValidationError(`glossary word length must be 1-${GLOSSARY_LIMITS.WORD_MAX}`);
    }
    if (seen.has(word)) {
      throw new CardValidationError(`duplicate glossary word: "${word}"`);
    }
    seen.add(word);
    if (!glossaryEntries.some(e => e.word === word)) {
      throw new CardValidationError(`glossary word "${word}" not found in project glossary`);
    }
  }
}
```

### Body cross-validation (src/glossary/cross-validate.ts)

New file for M6/M7 checks. Uses word-boundary regex for accurate matching:

```typescript
export interface GlossaryCrossWarning {
  type: 'undeclared-usage' | 'phantom-declaration';
  word: string;
  cardKey: string;
}

/**
 * Build a reusable matcher that finds glossary words in text via
 * a single compiled regex with word boundaries (case-insensitive).
 *
 * Returns a function: (text) → Set<canonical word>.
 * Performance: O(text_length + glossary_size) — single regex pass.
 */
export function buildGlossaryMatcher(
  entries: Array<{ word: string }>,
): (text: string) => Set<string> {
  if (entries.length === 0) return () => new Set();

  // Map lowercase → canonical for case-insensitive matching
  const canonMap = new Map<string, string>();
  for (const e of entries) canonMap.set(e.word.toLowerCase(), e.word);

  const escaped = entries.map(e =>
    e.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  // Sort longest-first so multi-word terms match before their substrings
  // e.g. "Code Link" matches before "Code"
  escaped.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

  return (text: string) => {
    const found = new Set<string>();
    for (const match of text.matchAll(pattern)) {
      const canonical = canonMap.get(match[1]!.toLowerCase());
      if (canonical) found.add(canonical);
    }
    return found;
  };
}

export function crossValidateGlossary(
  cardKey: string,
  body: string,
  summary: string,
  declaredGlossary: string[],
  allGlossaryEntries: Array<{ word: string }>,
): GlossaryCrossWarning[] {
  const text = `${summary}\n${body}`;
  const declaredSet = new Set(declaredGlossary);
  const matcher = buildGlossaryMatcher(allGlossaryEntries);
  const foundInText = matcher(text);

  const warnings: GlossaryCrossWarning[] = [];

  // M6: glossary word found in text but not declared by this card
  for (const word of foundInText) {
    if (!declaredSet.has(word)) {
      warnings.push({ type: 'undeclared-usage', word, cardKey });
    }
  }

  // M7: card declares word but it never appears in text
  for (const word of declaredGlossary) {
    if (!foundInText.has(word)) {
      warnings.push({ type: 'phantom-declaration', word, cardKey });
    }
  }

  return warnings;
}
```

**Design decisions:**
- **Case-insensitive matching (`gi` flag):** Body text often uses lowercase ("the job queue…") while glossary has canonical case ("Job"). Matching must bridge this gap.
- **Word boundary (`\b`):** Prevents "Card" from matching inside "CardFrontmatter". Eliminates the primary source of false positives from substring matching.
- **Longest-first sort:** Ensures multi-word terms like "Code Link" are matched before single-word "Code". Without this, "Code" would consume the match and "Code Link" would never fire.
- **Single regex pass:** O(text_length + glossary_size) vs O(glossary_size × text_length) for per-word `includes()`. For 500 glossary words × 100KB body, this is the difference between 1 pass and 500 passes.
- **Exported `buildGlossaryMatcher`:** Reusable by `validate_cards` (batch: build once, match many cards) and `suggest_card_scope`.

## 9. Glossary file I/O

New file: `src/glossary/io.ts`

```typescript
export interface GlossaryEntry {
  word: string;
  definition: string;
}

export function readGlossary(ctx: EmberdeckContext): GlossaryEntry[] {
  const path = glossaryFilePath(ctx);
  // File does not exist → empty glossary (normal: glossary not yet created)
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8');
  // Empty file → empty glossary (normal: all entries removed)
  if (content.trim() === '') return [];
  // Parse YAML, validate structure
  // Parse error on existing non-empty file → THROW GlossaryParseError
  // (corruption must surface immediately, not silently degrade to empty glossary
  //  which would cause all card operations to fail with "word not found")
}

export function writeGlossary(ctx: EmberdeckContext, entries: GlossaryEntry[]): void {
  // Sort entries alphabetically by word
  // Serialize to YAML
  // Write file with lock
}

export function glossaryFilePath(ctx: EmberdeckContext): string {
  // Return path: join(dirname(ctx.cardsDir), 'glossary.yaml')
  // Same directory as .emberdeck/
}
```

New file: `src/glossary/lock.ts`

```typescript
// Global mutex for all glossary write operations (define, remove, rename).
// Same Promise-chaining pattern as withCardLock in src/ops/safe.ts,
// but uses a single global lock (not per-key) since glossary is one shared file.
//
// Read-only operations (lookup) do NOT acquire this lock.
//
// For rename_glossary, the lock scope covers BOTH the DB transaction
// (card glossary_json updates) and the glossary.yaml file write,
// preventing interleaved reads of stale file state.
export function withGlossaryLock<T>(fn: () => T | Promise<T>): Promise<T>;
```

## 10. Existing card migration

18 existing cards in `.emberdeck/cards/` need `glossary` field added.

### Migration process

1. Agent reads all 18 card files, analyzes summaries + bodies.
2. Agent extracts all domain terms and proposes a full glossary + per-card glossary assignments as a single list.
3. User reviews and confirms/edits the full list in one pass.
4. Agent calls `define_glossary` once with all confirmed entries.
5. Agent updates all cards via `bulk_sync_cards` (adding glossary field).

**User confirmation: 1 time.** Not per-card, not per-word.

**DB migration runs automatically** via Drizzle on next startup. Column defaults to `'[]'` so existing DB rows won't break. Validation is enforced at create/update time, not at read time.

**Phase ordering note:** After Phase 3 (card schema) deploys but before Phase 5 (migration), existing cards are readable (DB default `'[]'`) and updatable (glossary is optional on update). However, **new card creation requires glossary.yaml to exist with at least one entry.** This is intentional progressive enforcement — it forces glossary definition before new card creation, which is the correct workflow order.

## 11. Usage changes

### Onboarding (new project)

```
BEFORE:
  analyze → read codebase → create intent cards → create spec cards → validate

AFTER:
  analyze → read codebase → DEFINE GLOSSARY (user confirms) → create intent cards → create spec cards → validate
```

Glossary must exist before cards. Cards require glossary field. Glossary field requires entries to exist in glossary.yaml.

### Building a feature

```
BEFORE:
  pre_change_check → get_card → write code → validate_code_links

AFTER:
  pre_change_check (now includes glossary + cross-validation warnings) → get_card → write code → validate_code_links
  IF new concept:
    define_glossary (user confirms) → update affected cards' glossary fields
```

### Refactoring (domain rename)

```
  rename_glossary(oldWord, newWord) → card glossary fields updated via DB transaction → manually update card bodies
```

## 12. Emberdeck skill update

Add to `.claude/skills/emberdeck/` skill file:

### New section: Glossary

```
## Glossary

The project glossary defines canonical domain vocabulary. Every card must declare which glossary words it uses.

### Rules

1. **Define glossary before creating cards.** Glossary entries must exist before cards can reference them.

2. **Every card must declare at least one glossary word.** The `glossary` field is required and non-empty. If a card doesn't use any domain term, the card shouldn't exist in Emberdeck.

3. **Agent proposes, user confirms.** Before calling `emberdeck_define_glossary`, show the proposed words and definitions to the user:

   ### Glossary proposal
   | Word | Definition |
   |------|-----------|
   | {word1} | {definition1} |
   | {word2} | {definition2} |

   Register?

4. **Use canonical names from glossary when writing card summaries and bodies.** Don't invent synonyms. (S1)

5. **Use glossary terms when naming code symbols.** Function names, class names, and variable names should reflect glossary vocabulary. (S2)

6. **Register new concepts before using them.** When a new domain concept emerges, call `emberdeck_define_glossary` (with user confirmation) before writing it into cards or code. (S3)

### Usages

**Onboarding:**
1. `emberdeck_analyze` — see project state
2. Read codebase, identify domain concepts
3. Propose glossary entries to user → `emberdeck_define_glossary` with all confirmed entries
4. Create intent cards (with glossary field)
5. Create spec cards (with glossary field)
6. `emberdeck_validate_cards`

**Adding glossary words mid-session:**
1. Identify new domain concept
2. Propose to user → `emberdeck_define_glossary`
3. Update affected cards' glossary fields via `emberdeck_update_card`

**Renaming a concept:**
1. `emberdeck_rename_glossary` — updates glossary + all card glossary fields
2. Manually update card bodies where the old word appears
```

### Route table update

Add glossary signals:

```
| Signal | Task type | Usage |
|--------|-----------|-------|
| No glossary.yaml or 0 entries | **Glossary onboarding** | Define glossary → then card onboarding |
| Cards exist but glossary missing | **Glossary backfill** | Define glossary → update existing cards |
```

## 13. Implementation order

### Phase 1: Foundation

1. `src/glossary/io.ts` — GlossaryEntry type, readGlossary, writeGlossary, glossaryFilePath
2. `src/glossary/lock.ts` — withGlossaryLock
3. `src/glossary/validation.ts` — validateGlossaryEntry (word/definition limits)
4. `src/glossary/cross-validate.ts` — body ↔ glossary cross-validation (M6, M7)
5. Tests for glossary I/O + cross-validation

### Phase 2: Glossary tools

6. `src/ops/glossary.ts` — defineGlossary, lookupGlossary, removeGlossary, renameGlossary
7. Register 4 new MCP tools in `src/mcp/tools.ts`
8. Tests for glossary ops + MCP tools

### Phase 3: Card schema

9. `src/card/types.ts` — add `glossary: string[]` to CardFrontmatter
10. `src/card/validation.ts` — add validateGlossaryField
11. `src/card/markdown.ts` — parse/serialize glossary field in frontmatter
12. `src/db/schema.ts` — add glossaryJson column
13. `drizzle/0001_glossary.sql` — ALTER TABLE migration
14. `src/db/card-repo.ts` — handle glossaryJson in CRUD
15. Tests for schema + validation + serialization

### Phase 4: Tool integration

16. `src/ops/create.ts` — validate glossary + body cross-validation on card creation
17. `src/ops/bulk-create.ts` — validate glossary + body cross-validation on bulk creation
18. `src/ops/update.ts` — validate glossary + body cross-validation on card update
19. `src/ops/sync.ts` — validate_cards glossary cross-check + body cross-validation + content-mismatch, sync_card_from_file glossary handling
20. `src/ops/context.ts` — check_drift glossary_broken type
21. `src/ops/impact.ts` — pre_change_check glossary + cross-validation attachment, regression_guard passthrough
22. `src/ops/analyze.ts` — glossary stats + onboarding_summary glossary state
23. `src/ops/query.ts` — read path: include glossary in get_card, get_cards, list_cards, get_card_context, get_card_tree responses
24. `src/ops/sync.ts` — export_card_to_file: include glossary in frontmatter
25. `src/ops/spec-sync.ts` — suggest_card_scope: add suggestedGlossary
26. MCP input schema updates for create_card, bulk_create_cards, update_card
27. Tests for each modified tool

### Phase 5: Migration + skill

28. Migrate 18 existing cards (add glossary field)
29. Create initial glossary.yaml for self-documentation cards
30. Update emberdeck skill file (glossary section + S1/S2/S3 instructions)
31. Full test suite pass (existing 931 tests + new glossary tests)

## 14. Test plan

### Glossary I/O
- Read nonexistent file → empty array ✓
- Read valid YAML → parsed entries ✓
- Read empty file → empty array ✓
- Read malformed YAML (file exists, non-empty) → throw GlossaryParseError ✓
- Write entries → valid YAML, sorted alphabetically ✓
- Write with lock → concurrent writes serialized ✓
- Concurrent define + define → serialized, no data loss ✓
- Concurrent define + rename → serialized via global lock ✓

### Body cross-validation
- Body contains undeclared glossary word → undeclared-usage warning
- Card declares word absent from body/summary → phantom-declaration warning
- All declared words present in body → no warnings
- Body contains no glossary words beyond declared → no warnings
- Case-insensitive word-boundary matching ("Job" matches "job" in body) ✓
- Word boundary prevents substring matches ("Card" does NOT match "CardFrontmatter") ✓
- Multi-word glossary terms matched correctly ("Code Link" in text → match) ✓
- Longest-first: "Code Link" matches before "Code" when both are in glossary ✓
- Regex special characters in glossary words are escaped safely (e.g., "C++") ✓
- Empty glossary → no warnings ✓
- `buildGlossaryMatcher` reuse: build once, match multiple cards ✓

### Glossary tools
- define_glossary: create multiple words in one call ✓
- define_glossary: update existing word (upsert) ✓
- define_glossary: empty entries array → error ✓
- define_glossary: word exceeds max length → error ✓
- define_glossary: definition exceeds max length → error ✓
- define_glossary: exceeds MAX_ENTRIES → error ✓
- define_glossary: one invalid entry in batch → entire batch rejected (all-or-nothing) ✓
- lookup_glossary: case-sensitive exact match ✓
- lookup_glossary: not found → appropriate response ✓
- lookup_glossary: no input → all entries ✓
- remove_glossary: existing word → removed ✓
- remove_glossary: nonexistent word → error ✓
- remove_glossary: word referenced by cards → warning with card keys ✓
- rename_glossary: valid rename → glossary + cards updated ✓
- rename_glossary: newWord already exists → error ✓
- rename_glossary: oldWord not found → error ✓
- rename_glossary: partial file write failure → DB consistent, fileWriteFailures reported ✓

### Card schema
- create_card with glossary field → stored in DB + file ✓
- create_card without glossary field → validation error ✓
- create_card with empty glossary → validation error ✓
- create_card with nonexistent glossary word → validation error ✓
- create_card with duplicate glossary entries → validation error ✓
- create_card with body cross-validation warnings → warnings in response ✓
- update_card glossary field → validated ✓
- update_card with body cross-validation warnings → warnings in response ✓
- sync_card_from_file with glossary field → parsed and stored ✓
- Card markdown serialization roundtrip with glossary field ✓

### Integration
- validate_cards detects glossary-broken cards ✓
- validate_cards reports glossary-unused entries ✓
- validate_cards reports glossary-undeclared-usage ✓
- validate_cards reports glossary-phantom-declaration ✓
- validate_cards detects glossary content-mismatch (DB vs file) ✓
- check_drift detects glossary_broken → auto-transition to drifted ✓
- regression_guard counts glossary-broken cards ✓
- pre_change_check includes full glossary + cross-validation warnings in response ✓
- analyze includes glossary stats ✓
- onboarding_summary includes glossary state (totalWords, exists) ✓
- remove_glossary → check_drift → card becomes drifted ✓
- rename_glossary → all card glossary fields updated ✓
- rename_glossary partial file failure → content-mismatch detected by validate_cards ✓
- suggest_card_scope includes suggestedGlossary ✓

### Read path
- get_card response includes glossary field ✓
- get_cards response includes glossary field ✓
- list_cards response includes glossary field ✓
- export_card_to_file includes glossary in frontmatter ✓
- Cards with empty glossary_json ('[]') return glossary as absent (not empty array) ✓

### Migration
- Existing cards readable after DB migration (glossary_json defaults to '[]') ✓
- After adding glossary field to existing cards, validate_cards passes ✓

---

# Redesign: Glossary Field Semantics & Cross-Validation

> **This section (15-24) supersedes M6/M7 as described in Sections 3 (enforcement level M6/M7), 7.1 (body cross-validation in create_card), 7.3 (glossary-undeclared-usage/phantom-declaration in validate_cards), 7.7 (pre_change_check glossary warnings), 8 (cross-validate.ts), and 14 (M6/M7 test cases). Those sections remain for historical context but are no longer the active design.**

## 15. Research Findings

Industry research across IEEE/ISO standards, DDD, enterprise tools (Collibra/Atlas), RFC practices, and documentation platforms reveals six patterns:

| # | Pattern | Source | Key insight |
|---|---------|--------|-------------|
| 1 | Define once, reference everywhere | RFC 2119, IEEE 24765 | Terms are defined in ONE authoritative place and referenced by all other documents. 40+ years of practice. |
| 2 | Terms are scoped, not owned | DDD Ubiquitous Language | A term belongs to a bounded context. Same term can have different meanings in different contexts. "Ownership" is the wrong metaphor. |
| 3 | Link terms to real assets | Collibra, Apache Atlas | Terms linked to actual data/code assets survive. Unlinked glossaries rot. Atlas uses term-to-entity assignment; Collibra uses "Represented by" relations. |
| 4 | Multiple definitions coexist | IEEE 24765 | One term can have numbered definitions from different source standards. "One true definition" is an anti-pattern. |
| 5 | Cross-cutting via abstraction layer | Collibra Data Concepts | When a term spans multiple domains, an abstract concept layer connects domain-specific usages. Not "pick one owner." |
| 6 | Text matching for display, not validation | Confluence glossary plugins | Smart Terms auto-highlights glossary words in pages as tooltips. This is a UI feature for comprehension, not a compliance check. |

**No AI coding tool (Kiro, Spec Kit, Tessl) has a glossary system.** Emberdeck is unique here.

## 16. Problem Diagnosis (revised)

The original design had TWO errors, not one:

**Error 1: glossary field = text concordance.** M6/M7 enforce that glossary field matches body text. This is wrong because a design document naturally references concepts it doesn't define.

**Error 2: glossary field = ownership.** The first redesign attempt replaced "text concordance" with "ownership" — "this card is the authority for this concept." This is also wrong because:
- Ownership requires a 1:1 mapping (one term → one intent owner), which creates card bloat for cross-cutting concepts
- It has no validation mechanism — after removing M6/M7, nothing checks if the "ownership" declaration is correct
- It's the wrong metaphor (DDD research: terms are scoped, not owned)

**Root cause**: The glossary field was trying to serve two purposes at once — **scoping the card's subject matter** and **controlling term governance**. These are different concerns.

## 17. Revised Model: Define Once, Scope Everywhere

### Glossary = project-level term registry

Following RFC 2119 and IEEE 24765: terms are **defined once** in `glossary.yaml` and **referenced** by all cards that discuss them. The glossary is the single source of truth for what a term means.

```
glossary.yaml (define)  →  card.glossary field (scope)
     ↓                            ↓
"What does this term mean?"    "What terms does this card discuss?"
```

### Glossary field = topic scope declaration

The `glossary` field on a card declares: **"This card discusses these domain concepts."** It scopes the card's subject matter.

- NOT "this card owns these concepts" (ownership model — too rigid)
- NOT "these words appear in the body text" (text concordance — too mechanical)
- IS "if you want to understand how this project handles these concepts, read this card"

This means:
- Multiple cards CAN declare the same term. A `card-lifecycle` intent discusses `compensation` in the context of lifecycle safety. A `safe-operations` intent discusses `compensation` in the context of DB-file consistency. Both declare it — different perspectives on the same concept.
- A card's glossary field should list the **primary topics** it addresses, not every term it mentions in passing. The distinction is judgment-based, not mechanical.

### What this changes from the original design

| Aspect | Original (M6/M7) | First redesign (ownership) | This redesign (scope) |
|--------|-------------------|---------------------------|----------------------|
| Glossary field means | "Words in body text" | "Concepts this card owns" | "Topics this card discusses" |
| Multiple cards, same term | Warning (M6) | Warning (G3 multi-intent) | Normal and expected |
| Cross-cutting concepts | N/A | "Make a dedicated card" | Multiple cards declare naturally |
| Validation | Text regex matching | Structural ownership checks | Structural consistency checks |
| Metaphor | Concordance | Property ownership | Topic tagging |

## 18. Term Extraction Process

### Extraction criteria (unchanged from first redesign)

A concept qualifies as a glossary term when ALL four conditions are met:

| # | Criterion | Test |
|---|-----------|------|
| 1 | Non-obvious meaning | Project-specific meaning different from dictionary definition |
| 2 | Cross-cutting | Appears in 2+ cards or design discussions |
| 3 | Decision-bearing | Encodes a design decision |
| 4 | Not a code symbol | Cannot be fully understood by reading a single class/function/type |

### Proposal format

```
### Glossary proposal
| Word | Definition | Evidence |
|------|-----------|---------|
| drift | State where code has diverged from spec | Cross-cuts lifecycle, binding, and analysis. Encodes auto-detection policy with 4 types. |

Register?
```

## 19. Cross-Validation Redesign

### Removed

| ID | Name | Reason |
|----|------|--------|
| M6 | `glossary-undeclared-usage` | Text matching. A card referencing a term without declaring it as a topic is normal. |
| M7 | `glossary-phantom-declaration` | A card can discuss a concept without using the exact glossary word. |

### Kept (unchanged)

| ID | Name |
|----|------|
| M1 | Glossary field required when glossary.yaml has entries |
| M2 | Declared words must exist in glossary.yaml |
| M3 | No duplicate declarations within a card |
| M4 | Glossary word deleted → referencing cards drift |
| M5 | Glossary word renamed → card fields bulk-updated |
| M8 | pre_change_check includes full glossary |
| M9 | validate_cards cross-checks all cards |

### Revised

| Code | Name | Condition | Severity | Notes |
|------|------|-----------|----------|-------|
| G1 | `glossary-broken` | Card declares word not in glossary.yaml | error | Existing. Renamed from M2 check in validateCards. |
| G2 | `glossary-unused` | Word in glossary.yaml, no card declares it | warning | Existing. Term defined but no card discusses it. |

### Removed from first redesign

| Code | Name | Why removed |
|------|------|-------------|
| G3 | `glossary-multi-intent` | Multiple cards discussing the same concept is normal in the scope model. |
| G4 | `glossary-orphan-contract` | A spec can discuss a concept without a related intent also discussing it. The parent/relation hierarchy already ensures specs connect to intents. |

### `buildGlossaryMatcher` disposition

Repurposed as an **analysis utility** (not validation):
- `suggest_card_scope`: recommends glossary words for new cards
- `emberdeck_analyze`: shows which terms are discussed where (informational, no warnings)

### Why fewer checks is better

The original system had 9 mechanical checks (M1-M9). M6/M7 were wrong. The first redesign added G3/G4 which introduced new problems (ownership rigidity, card bloat).

The revised system has 7 mechanical checks (M1-M5, G1-G2) — all of which are **structurally verifiable** (word exists in YAML: yes/no, field is non-empty: yes/no). No check requires judging whether a card "should" discuss a concept. That judgment is left to the agent and user during card creation, guided by the skill instructions.

## 20. Glossary Lifecycle (unchanged)

| Event | Trigger | Action | Cascade |
|-------|---------|--------|---------|
| Add | New concept meets 4 criteria + user confirmation | `emberdeck_define_glossary` | None |
| Update | Definition evolves | `emberdeck_define_glossary` (upsert) | None |
| Remove | Concept eliminated | `emberdeck_remove_glossary` | Cards declaring it → `glossary_broken` drift |
| Rename | Concept rebranded | `emberdeck_rename_glossary` | Auto-updates card glossary fields. Bodies need manual `bodyPatches`. |

## 21. Code Changes

### Deployment order

Code changes MUST deploy before SKILL.md update. If SKILL.md deploys first, agents receive instructions referencing removed behavior (no glossaryWarnings, no M6/M7) while the code still produces them.

Order: (1) code changes → (2) tests → (3) SKILL.md → (4) card migration → (5) MCP tool descriptions

### Files to modify

| File | Change |
|------|--------|
| `src/glossary/cross-validate.ts` | Delete `crossValidateGlossary` function and `GlossaryCrossWarning` type (no remaining callers after removal). Keep `buildGlossaryMatcher` (used by suggest_card_scope in spec-sync.ts). |
| `src/ops/create.ts` | Remove `crossValidateGlossary` call (L206-219). Remove `glossaryWarnings` from `CreateCardResult` interface. Remove `crossValidateGlossary` import. |
| `src/ops/update.ts` | Remove `crossValidateGlossary` call. Remove `glossaryWarnings` from `UpdateCardResult` interface. Remove glossary warning generation. Remove import. |
| `src/ops/bulk-create.ts` | Remove `glossaryWarnings` from bulk create result if present. Remove import. |
| `src/ops/sync.ts` (`validateCards`) | Remove M6/M7 warning block (L475-498): the `glossary-undeclared-usage` and `glossary-phantom-declaration` warning generation inside the body cross-validation loop. |
| `src/index.ts` | Remove `crossValidateGlossary` and `GlossaryCrossWarning` from barrel export. Keep `buildGlossaryMatcher` export. |
| `.claude/skills/emberdeck/SKILL.md` | Full rewrite per Section 22. |
| `src/mcp/tools.ts` | Update `emberdeck_define_glossary` description from `"Define or update words in the project glossary. Use when new domain concepts are introduced or existing definitions need refinement. Agent must show proposed words and definitions to the user and get confirmation before calling."` to `"Define or update words in the project glossary. Use when new domain concepts are introduced or existing definitions need refinement. Agent must show the glossary-proposal template (words, definitions, and evidence) to the user and get confirmation before calling."` |
| `test/ops/glossary.test.ts` | Remove: `crossValidateGlossary` describe block, M6 undeclared-usage tests (L162, L441), M7 phantom-declaration tests (L173, L451), `glossaryWarnings` assertions (L448, L458, L468), `glossary-undeclared-usage` assertion in validateCards (L524), `glossary-phantom-declaration` assertion in validateCards (L532). |

### Files unchanged

| File | Reason |
|------|--------|
| `src/glossary/io.ts` | Read/write correct |
| `src/glossary/validation.ts` | Entry + field validation correct (M1/M2/M3) |
| `src/glossary/lock.ts` | Mutex correct |
| `src/ops/glossary.ts` | CRUD correct |
| `src/ops/context.ts` | `glossary_broken` drift correct (M4) |
| `src/ops/analyze.ts` | Glossary stats correct (G2 already here) |
| `src/ops/spec-sync.ts` | Uses `buildGlossaryMatcher` for suggestedGlossary (kept) |
| DB schema | `glossary_json` format unchanged |

### Rollback

All changes are additive removals (deleting code, removing warnings). Rollback = revert the commit. `crossValidateGlossary` and callers can be re-added without schema changes. No DB migration involved.

## 22. SKILL.md Full Rewrite

Below is the complete SKILL.md after all changes. This is the canonical reference for implementation — copy the content between the ` ```markdown ` fences verbatim to `.claude/skills/emberdeck/SKILL.md`.

Key changes from current version:
- glossary field semantics: "topics this card discusses" (not text concordance, not ownership)
- M6/M7 removed from error_recovery
- glossary-proposal template: Evidence column added
- card_analysis_template: glossary line updated
- model_notes: glossary warnings reference removed
- onboarding step 2: 4 extraction criteria added
- intent GOOD example: requirement numbering uses R-001 (project convention). Existing cards using FR-001 will be updated during card migration (Section 23).
- `<critical>` tags added for highest-priority rules
- tool_protocol glossary field description updated

```markdown
---
name: emberdeck
description: Design knowledge management for codebases using Emberdeck MCP tools. Trigger when the user asks to build, change, fix, or refactor code in a project with emberdeck configured. Also trigger on "/emberdeck" or when the user asks about specs, design cards, or acceptance criteria.
---

<rules>
<critical>
1. Read relevant cards before modifying code. Run `emberdeck_validate_code_links` after. Always.
</critical>
2. Show card analysis to user and get confirmation before creating any card.
3. Intent cards are design documents: problem, goals, user scenarios, requirements, success criteria, scope. Spec cards capture verifiable contracts bound to code. Only put non-discoverable knowledge in cards — function signatures, file paths, and tech stack details degrade agent performance.
4. Define glossary before creating cards. When `glossary.yaml` has entries, every new card requires a non-empty `glossary` field listing its primary topics. Multiple cards may declare the same term when they discuss it from different perspectives.
</rules>

<glossary_semantics>
The project glossary (`glossary.yaml`) is the single source of truth for domain vocabulary. Terms are **defined once** in the glossary and **referenced** by cards that discuss them.

The `glossary` field on a card = **topic scope declaration**: "this card discusses these domain concepts." It is NOT a text concordance (not every glossary word in the body), and NOT ownership (not "this card is the authority for this concept").

A card's glossary field should list the **primary topics** it addresses. Mentioning a term in passing does not require declaring it. Multiple cards declaring the same term is normal — different cards discuss the same concept from different perspectives.

**When to add a new term to the glossary** (criteria for `emberdeck_define_glossary`, NOT for selecting which existing terms go in a card's glossary field):

A term qualifies for the glossary when ALL four conditions are met:
1. **Non-obvious meaning** — project-specific, different from dictionary definition
2. **Cross-cutting** — appears in 2+ cards or design areas
3. **Decision-bearing** — encodes a design decision
4. **Not a code symbol** — cannot be understood by reading a single class/function/type
</glossary_semantics>

<route_table>
Match the FIRST row whose signal is true, then follow the named workflow.

| # | Signal | Workflow |
|---|--------|----------|
| 1 | No `.emberdeck/` or 0 cards | onboarding |
| 2 | Cards exist, no `glossary.yaml` or 0 glossary entries | glossary-backfill |
| 3 | Code change affects card scope | feature |
| 4 | Code change outside all card scopes | feature (step 1 reveals uncovered files) |
| 5 | No code change (deps, CI, lint, docs) | skip card workflow |
| 6 | No modification intent | read cards for context only |
</route_table>

<workflows>

<workflow name="onboarding">
1. `emberdeck_analyze` — current state. Then `emberdeck_write_spec_annotations` to reconcile (removes orphan @spec from previous sessions, adds missing ones). Reconciler is idempotent.
2. Read codebase. Identify domain concepts meeting ALL 4 criteria: (1) non-obvious meaning, (2) cross-cutting across 2+ areas, (3) encodes a design decision, (4) not a code symbol. Focus on concepts whose meaning is not self-evident from any single function or type.
3. Propose glossary to user (see glossary-proposal template — include Evidence column). Get confirmation. `emberdeck_define_glossary`.
4. Create intent cards (with `glossary` field). Show card-analysis template for each.
5. Create spec cards under intents (with `glossary`, `codeLinks`, `relations`).
6. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken and 0 broken-chain warnings before finishing.
7. `emberdeck_write_spec_annotations` — inject `@spec card-key` JSDoc tags into source code for all codeLinks.
</workflow>

<workflow name="glossary-backfill">
1. `emberdeck_lookup_glossary` — confirm empty.
2. Read existing card bodies and summaries. Extract domain terms meeting the 4 criteria.
3. Propose glossary to user (with Evidence column). `emberdeck_define_glossary`.
4. Update each card: `emberdeck_update_card` with `glossary` field.
5. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken warnings before finishing.
</workflow>

<workflow name="feature">
1. `emberdeck_pre_change_check` with files to modify. Response includes full `glossary` and affected cards.
   - critical risk: stop, show impact to user, get confirmation.
   - high risk: show affected cards to user, get confirmation.
   - medium/low risk: proceed.
2. `emberdeck_get_card` for each affected card — these are your constraints.
   - Direct cards: read full body. Transitive cards: summary only.
3. If no cards exist for the area: create intent card first (show card-analysis, include glossary), then spec cards.
4. Write code within card constraints.
5. If a new domain concept emerges: propose glossary entry to user → `emberdeck_define_glossary` → update affected cards' glossary fields.
6. If your change extends an existing spec's scope: update the spec card body and glossary field.
7. GATE: `emberdeck_validate_code_links` — pass with 0 broken links before finishing.
8. `emberdeck_write_spec_annotations` — inject `@spec card-key` JSDoc tags for new/changed codeLinks.
</workflow>

</workflows>

<tool_protocol>

Glossary tools — when and how:

| Tool | When | Requires user confirmation |
|------|------|---------------------------|
| `emberdeck_define_glossary` | New domain concept or definition update. Batch up to 50. All-or-nothing validation. | Yes — show glossary-proposal first |
| `emberdeck_lookup_glossary` | Check a term's meaning, or list all terms at session start | No |
| `emberdeck_remove_glossary` | Domain concept eliminated from project. Cards referencing it become drifted. | Yes |
| `emberdeck_rename_glossary` | Domain concept rebranded. Auto-updates glossary + all card glossary fields. Card bodies need manual update. | Yes |
| `emberdeck_find_cards_by_glossary_word` | Find which cards declare a specific glossary word. Use to audit term usage or assess impact before removing/renaming. | No |
| `emberdeck_reset` | Delete all cards (DB + files), clear glossary. Run `emberdeck_write_spec_annotations` after to remove orphan @spec from source. | Yes |

Rename sequence:
1. `emberdeck_rename_glossary` with oldWord, newWord, optional definition.
2. `emberdeck_search_cards` for old word in card bodies.
3. `emberdeck_update_card` with bodyPatches to replace old word in each affected body.

Card creation — always include:
- `glossary`: primary domain concepts this card discusses (required when glossary.yaml exists)
- `type`: intent (design documents) or spec (behavioral contracts)
- `codeLinks`: required for spec cards
- `relations`: spec cards relate to at least one intent card

</tool_protocol>

<card_analysis_template>
Show this to the user before every card creation:

```
### Card analysis: {key}
- **Type**: intent | spec
- **Glossary**: [{primary domain concepts this card discusses}]
- **Must guarantee**: {what this card ensures}
- **Excluded**: {what is deliberately out of scope}
- **Breaks if violated**: {concrete consequence}
```
</card_analysis_template>

<glossary_proposal_template>
Show this to the user before calling `emberdeck_define_glossary`:

```
### Glossary proposal
| Word | Definition | Evidence |
|------|-----------|---------|
| {word} | {definition} | {which areas use it, what decision it encodes, why non-obvious} |

Register?
```
</glossary_proposal_template>

<error_recovery>

When `emberdeck_validate_cards` reports warnings:

| Warning | Cause | Recovery |
|---------|-------|----------|
| glossary-broken | Card declares a glossary word that no longer exists in glossary.yaml | `emberdeck_define_glossary` to re-add, or `emberdeck_update_card` to remove the word from the card's glossary field |
| glossary-unused | Glossary word not declared by any card | Informational — consider creating a card that discusses this concept or removing the glossary entry |
| content-mismatch | DB and file diverged | `emberdeck_export_card_to_file` to regenerate file from DB |
| broken-chain | Spec card has no link to any intent card | Add a relation or parent to an intent card |

When `emberdeck_validate_code_links` finds broken links:
1. Check if the symbol was renamed → `emberdeck_sync_symbol_changes`.
2. Check if the file was moved → update the card's codeLinks.
3. If the symbol was intentionally removed → update or delete the card.

</error_recovery>

<card_types>

## intent — Design document

An intent card answers: **"What are we building, why, and under what constraints?"**

It is a design document that defines the problem, goals, user scenarios, requirements, success criteria, and scope boundaries for a domain area. Spec cards are derived from intent cards — no spec exists without an intent that justifies it. No codeLinks. Can be root card.

### REQUIRED content in intent body:

**Problem & Goals** — What problem this design solves and what outcomes it achieves. Be specific: who has the problem, what breaks without this, what success looks like.

**User Scenarios** — Prioritized (P1/P2/P3) scenarios describing how the system is used. Each scenario must be independently testable with Given/When/Then acceptance criteria.

**Requirements** — Numbered requirements (R-001, R-002, ...) using RFC 2119 keywords (MUST, SHALL, SHOULD, MAY). Each requirement must be testable and unambiguous.

**Success Criteria** — Measurable outcomes that define when the design is fulfilled. Technology-agnostic, verifiable without knowing implementation.

**Scope & Constraints** — What this design covers, what it explicitly excludes, and what assumptions were made.

### GOOD intent card body:

```
## Problem & Goals
Agents modifying code need to know which design decisions govern each area. Without this, agents silently violate cross-module contracts. Goal: every code change is checked against its governing design before execution.

## User Scenarios

### P1: Agent reads design before code change
Given an agent is about to modify src/ops/create.ts,
When it calls pre_change_check with the file path,
Then it receives affected cards, risk level, and must read each card before proceeding.

### P2: Drift detected after code change
Given a spec card is active with resolved codeLinks,
When the linked symbol is renamed or deleted,
Then the card auto-transitions to drifted status in both DB and file.

## Requirements
- R-001: System MUST store every card in both DB and markdown file (dual-storage invariant).
- R-002: System MUST reject spec card activation when any codeLink is unresolved.
- R-003: System MUST auto-detect drift via 4 mechanisms: broken_link, boundary_inactive, symbol_changed, glossary_broken.
- R-004: System MUST compensate DB changes when file write fails after DB commit.

## Success Criteria
- SC-001: 0 broken codeLinks on active spec cards at any point in time.
- SC-002: Every code change to a card-covered file is preceded by pre_change_check.
- SC-003: Drifted cards are detected within one check_drift cycle — no silent drift.

## Scope & Constraints
- Covers: card lifecycle, dual-storage, drift detection, code binding, glossary enforcement.
- Excludes: code generation, linting, CI, test automation, workflow orchestration.
- Assumes: gildash is available for symbol resolution when projectRoot is set.
```

### BAD intent card body (common mistakes):

- ✗ Code structure: "The system uses SQLite with Drizzle ORM. Cards are stored in the card table."
- ✗ Abstract policy only: "Always: Card is source of truth." (policy without scenarios, requirements, or success criteria)
- ✗ Implementation detail: "writeCardFile uses atomic rename via temp file."
- ✗ Task list: "1. Add migration 2. Update schema 3. Write tests" (execution plan, not design)

---

## spec — Behavioral contract bound to code

A spec card answers: **"What does the system guarantee?"**

It captures verifiable behavioral contracts bound to specific code symbols via codeLinks. Every spec card MUST relate to at least one intent card — a contract without governing design is rootless. Requires codeLinks.

### REQUIRED content in spec body:

**Given/When/Then contracts** — Use RFC 2119 keywords (MUST, SHALL, SHOULD, MAY). Each contract is one testable guarantee.

**Failure modes** — Table: what violation occurs → what the system does. Agents need explicit failure behavior, not just happy paths.

### GOOD spec card body:

```
## Contracts
- WHEN a spec card status is set to active, THEN all codeLinks MUST resolve to existing symbols via gildash. IF any link fails, activation MUST be rejected with ActivationGuardError.
- WHEN a card is deleted with force=true AND it has children, THEN children MUST become orphans (parent=null) AND relations MUST be cleaned up bidirectionally.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| codeLink target symbol deleted | Card auto-transitions to drifted |
| File write fails after DB commit | Compensation reverts DB change; CompensationError thrown if revert also fails |
```

### BAD spec card body (common mistakes):

- ✗ Policies: "We always use compensation pattern" (belongs in intent)
- ✗ Implementation: "deleteByKey() calls SQL DELETE WHERE key=?" (discoverable from code)
- ✗ Task list: "1. Add migration 2. Update schema 3. Write tests" (execution plan, not contract)
- ✗ Verification commands: "Run `bun test`" (tooling, not contract)
- ✗ File paths in body text (use codeLinks field instead)

---

## Summary: what goes where

| Content | intent | spec | Neither |
|---------|--------|------|---------|
| Problem & Goals | ✓ | | |
| User Scenarios (P1/P2/P3) | ✓ | | |
| Requirements (R-001...) | ✓ | | |
| Success Criteria (measurable) | ✓ | | |
| Scope & Constraints | ✓ | | |
| Given/When/Then contracts (code-bound) | | ✓ | |
| Failure mode table | | ✓ | |
| Code structure descriptions | | | ✗ discoverable |
| File paths, class names | | | ✗ discoverable |
| Task checklists | | | ✗ execution plan |
| Verification commands | | | ✗ tooling |

Hierarchy: parent-child when scope is strict subset. Flat peers otherwise. Max 3 levels.

</card_types>

<model_notes>
- Fewer precise cards beat many vague ones.
- Call emberdeck tools directly — subagents lose card context.
- Always show the card-analysis template before creation, even when being concise elsewhere.
</model_notes>

<critical>Read cards before modifying code. Validate code links after. Run glossary backfill when glossary is empty.</critical>
```

## 23. Migration of Existing Cards

After code changes deploy and SKILL.md is updated:

1. For each card, verify glossary field lists the **primary topics** the card discusses (not text concordance, not ownership)
2. Remove terms that are merely referenced in passing (not a primary topic)
3. Update requirement numbering from FR-001 to R-001 in intent card bodies (via `bodyPatches`)
4. Cards requiring M6/M7 content removal (explicit list):
   - **`spec/glossary-cross-validation`**: Contracts C-03, C-04, C-06 are entirely about M6/M7. codeLinks include `crossValidateGlossary` (deleted) and `GlossaryCrossWarning` (deleted). This card must be substantially rewritten or deleted — its core subject no longer exists.
   - **`glossary-system`**: Parent intent card. Body describes "cross-validates card bodies against declared glossary terms, detecting undeclared usage and phantom declarations." Must be rewritten to reflect the scope model.
   - **`spec/create-card`**: Contract C-09 references "glossaryWarnings" field (removed). Must update or remove this contract.
5. Run `emberdeck_validate_cards` — expect 0 `glossary-broken`
6. Run `emberdeck_validate_code_links` — verify no broken codeLinks from deleted symbols

Agent proposes changes, user confirms.

## 24. Verification

1. `bun test` — all tests pass (M6/M7 tests removed)
2. `emberdeck_validate_cards` — no `glossary-undeclared-usage` or `glossary-phantom-declaration` warnings (types removed)
3. Card creation no longer returns `glossaryWarnings` field
4. Card update no longer returns `glossaryWarnings` field
5. Existing G1 (`glossary-broken`) and G2 (`glossary-unused`) continue to work
6. `src/index.ts` no longer exports `crossValidateGlossary` or `GlossaryCrossWarning`
7. MCP tool description for `emberdeck_define_glossary` mentions "glossary-proposal template (words, definitions, and evidence)"
8. SKILL.md matches Section 22 rewrite verbatim
9. `emberdeck_validate_code_links` — 0 broken links from deleted `crossValidateGlossary`/`GlossaryCrossWarning` symbols
10. `spec/glossary-cross-validation` card rewritten or deleted — no contracts referencing M6/M7
