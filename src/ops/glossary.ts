import { parseStringArrayJson } from '../card/json-fields';
import type { EmberdeckContext } from '../config';
import type { GlossaryEntry } from '../glossary/io';
import type { CardRow } from '../db/repository';
import {
  readGlossary,
  writeGlossary,
  GLOSSARY_LIMITS,
  GlossaryValidationError,
} from '../glossary/io';
import { GlossaryNotFoundError } from '../glossary/errors';
import { validateGlossaryEntry } from '../glossary/validation';
import { deleteCardFile } from '../fs/writer';
import { DrizzleChangelogRepository, CHANGED_BY } from '../db/changelog-repo';
import { txDb } from '../db/connection';
import { card as cardTable } from '../db/schema';
import { eq } from 'drizzle-orm';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';

// ── define_glossary ──────────────────────────────────────────────────────

export interface DefineGlossaryInput {
  entries: Array<{ word: string; definition: string }>;
}

export interface DefineGlossaryResult {
  results: Array<{ action: 'created' | 'updated'; word: string; definition: string }>;
}

/**
 * Define or update words in the project glossary.
 * All-or-nothing: if any entry fails validation, entire call is rejected.
 * @spec glossary/lifecycle/define-and-lookup
 */
export async function defineGlossary(
  ctx: EmberdeckContext,
  input: DefineGlossaryInput,
): Promise<DefineGlossaryResult> {
  if (!input.entries || input.entries.length === 0) {
    throw new GlossaryValidationError('entries must contain at least one entry');
  }
  if (input.entries.length > GLOSSARY_LIMITS.MAX_ENTRIES_PER_CALL) {
    throw new GlossaryValidationError(
      `entries exceeds max ${GLOSSARY_LIMITS.MAX_ENTRIES_PER_CALL} per call (got ${input.entries.length})`,
    );
  }

  // Validate all entries before acquiring lock (fail fast)
  for (const entry of input.entries) {
    validateGlossaryEntry(entry);
  }

  return (async () => {
    const existing = readGlossary(ctx);
    const existingMap = new Map(existing.map((e) => [e.word, e]));

    // Check total count after upsert
    const newWords = input.entries.filter((e) => !existingMap.has(e.word));
    if (existing.length + newWords.length > GLOSSARY_LIMITS.MAX_ENTRIES) {
      throw new GlossaryValidationError(
        `total glossary entries would exceed max ${GLOSSARY_LIMITS.MAX_ENTRIES} (current: ${existing.length}, adding: ${newWords.length})`,
      );
    }

    const results: DefineGlossaryResult['results'] = [];

    for (const entry of input.entries) {
      const ex = existingMap.get(entry.word);
      if (ex) {
        ex.definition = entry.definition;
        results.push({ action: 'updated', word: entry.word, definition: entry.definition });
      } else {
        existing.push({ word: entry.word, definition: entry.definition });
        existingMap.set(entry.word, { word: entry.word, definition: entry.definition });
        results.push({ action: 'created', word: entry.word, definition: entry.definition });
      }
    }

    writeGlossary(ctx, existing);
    return { results };
  })();
}

// ── lookup_glossary ──────────────────────────────────────────────────────

export interface LookupGlossaryResult {
  found: boolean;
  entry?: GlossaryEntry;
  entries?: GlossaryEntry[];
}

/**
 * Look up a word in the project glossary, or list all entries.
 * Case-sensitive exact match when word is provided.
 * No lock needed — read-only.
 * @spec glossary/lifecycle/define-and-lookup
 */
export function lookupGlossary(
  ctx: EmberdeckContext,
  word?: string,
): LookupGlossaryResult {
  const entries = readGlossary(ctx);

  // Treat empty string the same as omitted — CLI's `glossary lookup ''` should
  // mean 'list all', matching the truthy check used in src/cli/commands/glossary.ts.
  if (word !== undefined && word !== '') {
    const entry = entries.find((e) => e.word === word);
    return entry
      ? { found: true, entry }
      : { found: false };
  }

  return { found: true, entries };
}

// ── remove_glossary ──────────────────────────────────────────────────────

export interface RemoveGlossaryResult {
  removed: string;
  affectedCardKeys: string[];
}

/**
 * Remove a word from the project glossary.
 * Cards referencing this word will become drifted on next check_drift.
 * @spec glossary/lifecycle/remove-rename-reset
 */
export async function removeGlossary(
  ctx: EmberdeckContext,
  word: string,
): Promise<RemoveGlossaryResult> {
  if (!word || word.length === 0) {
    throw new GlossaryValidationError('word must not be empty');
  }

  return (async () => {
    const entries = readGlossary(ctx);
    const idx = entries.findIndex((e) => e.word === word);
    if (idx === -1) {
      throw new GlossaryNotFoundError(word);
    }

    entries.splice(idx, 1);
    writeGlossary(ctx, entries);

    const affectedCardKeys = cardsContainingGlossaryWord(ctx, word).map((c) => c.key);
    return { removed: word, affectedCardKeys };
  })();
}

// ── rename_glossary ──────────────────────────────────────────────────────

export interface RenameGlossaryResult {
  renamedFrom: string;
  renamedTo: string;
  definition: string;
  cardsUpdated: number;
  /** Keys of cards whose glossary field referenced the old word and were updated. */
  affectedCardKeys: string[];
  fileWriteFailures: string[];
}

/**
 * Rename a word in the project glossary.
 * Updates the glossary file and all card glossary fields that reference the old word.
 * Card bodies are NOT updated (manual).
 *
 * Uses safeWriteOperation pattern: glossary.yaml write first, DB transaction second.
 * If glossary.yaml write fails -> nothing changed.
 * If DB transaction fails -> compensate by reverting glossary.yaml.
 * @spec glossary/lifecycle/remove-rename-reset
 */
export async function renameGlossary(
  ctx: EmberdeckContext,
  oldWord: string,
  newWord: string,
  definition?: string,
): Promise<RenameGlossaryResult> {
  if (!oldWord || oldWord.length === 0) {
    throw new GlossaryValidationError('oldWord must not be empty');
  }
  if (!newWord || newWord.length === 0) {
    throw new GlossaryValidationError('newWord must not be empty');
  }
  if (newWord.length > GLOSSARY_LIMITS.WORD_MAX) {
    throw new GlossaryValidationError(
      `newWord exceeds maximum length of ${GLOSSARY_LIMITS.WORD_MAX} characters`,
    );
  }
  if (definition !== undefined && definition.length > GLOSSARY_LIMITS.DEFINITION_MAX) {
    throw new GlossaryValidationError(
      `definition exceeds maximum length of ${GLOSSARY_LIMITS.DEFINITION_MAX} characters`,
    );
  }

  return (async () => {
    const entries = readGlossary(ctx);
    const oldEntry = entries.find((e) => e.word === oldWord);
    if (!oldEntry) {
      throw new GlossaryNotFoundError(oldWord);
    }
    if (entries.some((e) => e.word === newWord)) {
      throw new GlossaryValidationError(`glossary word "${newWord}" already exists`);
    }

    // Collect affected cards before any mutation
    const affectedCards = cardsContainingGlossaryWord(ctx, oldWord);

    // Write glossary.yaml FIRST (file before DB — if this fails, nothing changed)
    const originalEntries = entries.map((e) => ({ ...e }));
    oldEntry.word = newWord;
    if (definition !== undefined) oldEntry.definition = definition;
    const finalDefinition = oldEntry.definition;

    writeGlossary(ctx, entries);

    // DB transaction: update every affected card's glossary_json plus a
    // changelog row, all through the repository abstraction so a mock context
    // can intercept the writes during tests.
    try {
      if (affectedCards.length > 0) {
        const now = new Date().toISOString();
        ctx.db.transaction((tx) => {
          const d = txDb(tx);
          const changelogRepo = new DrizzleChangelogRepository(d);

          for (const affected of affectedCards) {
            const glossary = parseStringArrayJson(affected.glossaryJson);
            const updated = glossary.map((w: string) => (w === oldWord ? newWord : w));
            d
              .update(cardTable)
              .set({ glossaryJson: JSON.stringify(updated), updatedAt: now })
              .where(eq(cardTable.key, affected.key))
              .run();

            changelogRepo.insert({
              cardKey: affected.key,
              field: 'glossary',
              oldValue: oldWord,
              newValue: newWord,
              changedAt: now,
              changedBy: CHANGED_BY.AGENT,
            });
          }
        });
      }
    } catch (dbErr) {
      // DB failed — revert glossary.yaml
      writeGlossary(ctx, originalEntries);
      throw dbErr;
    }

    // Best-effort: rewrite affected card .md files with updated frontmatter
    const fileWriteFailures: string[] = [];
    for (const card of affectedCards) {
      try {
        const cardFile = await readCardFile(card.filePath);
        if (cardFile.frontmatter.glossary) {
          cardFile.frontmatter.glossary = cardFile.frontmatter.glossary.map(
            (w) => (w === oldWord ? newWord : w),
          );
          await writeCardFile(card.filePath, cardFile);
        }
      } catch {
        fileWriteFailures.push(card.key);
      }
    }

    return {
      renamedFrom: oldWord,
      renamedTo: newWord,
      definition: finalDefinition,
      cardsUpdated: affectedCards.length,
      affectedCardKeys: affectedCards.map((c) => c.key),
      fileWriteFailures,
    };
  })();
}

// ── find_cards_by_glossary_word ───────────────────────────────────────────

export interface GlossaryCardMatch {
  key: string;
  summary: string;
}

/**
 * Find all cards that declare a specific glossary word in their glossary field.
 * @spec glossary/lifecycle/define-and-lookup
 */
export function findCardsByGlossaryWord(
  ctx: EmberdeckContext,
  word: string,
): GlossaryCardMatch[] {
  return cardsContainingGlossaryWord(ctx, word).map((c) => ({ key: c.key, summary: c.summary }));
}

function cardsContainingGlossaryWord(ctx: EmberdeckContext, word: string): CardRow[] {
  return ctx.cardRepo
    .list()
    .filter((c) => parseStringArrayJson(c.glossaryJson).includes(word));
}

// ── reset ─────────────────────────────────────────────────────────────────

export interface ResetResult {
  cardsDeleted: number;
  glossaryCleared: boolean;
  /** Card files whose unlink failed during reset. Reported but not blocking. */
  failedFileDeletes: string[];
}

/**
 * Reset all emberdeck state: delete all cards (DB + files), clear glossary.yaml.
 * `@spec` annotations in source are NOT removed — re-author or `ed spec sync`
 * after reset to reconcile the DB code_link cache against source.
 * @spec glossary/lifecycle/remove-rename-reset
 */
export async function resetEmberdeck(
  ctx: EmberdeckContext,
): Promise<ResetResult> {
  const allCards = ctx.cardRepo.list();
  let cardsDeleted = 0;
  const failedFileDeletes: string[] = [];

  // Delete all card files + DB entries.
  // File deletes parallelized in batches to amortize fs round-trips.
  // Per-file failures collected into failedFileDeletes so they surface on the result.
  const pending: Array<{ filePath: string; promise: Promise<unknown> }> = [];
  const FILE_BATCH = 20;
  const drain = async (): Promise<void> => {
    const results = await Promise.allSettled(pending.map((p) => p.promise));
    results.forEach((r, i) => {
      if (r.status === 'rejected') failedFileDeletes.push(pending[i]!.filePath);
    });
    pending.length = 0;
  };
  for (const card of allCards) {
    try {
      ctx.cardRepo.deleteByKey(card.key);
      cardsDeleted++;
      pending.push({ filePath: card.filePath, promise: deleteCardFile(card.filePath) });
      if (pending.length >= FILE_BATCH) await drain();
    } catch { /* skip DB delete failure (rare; row may already be gone) */ }
  }
  if (pending.length > 0) await drain();

  // Prune orphan tags
  ctx.classificationRepo.pruneOrphans();

  // Clear glossary (writeGlossary is already imported statically at module top)
  let glossaryCleared = false;
  try {
    writeGlossary(ctx, []);
    glossaryCleared = true;
  } catch { /* skip */ }

  return { cardsDeleted, glossaryCleared, failedFileDeletes };
}

// ── Helpers ──────────────────────────────────────────────────────────────

