import type { EmberdeckContext } from '../config';
import type { GlossaryEntry } from '../glossary/io';
import type { CardRow } from '../db/repository';
import {
  readGlossary,
  writeGlossary,
  GLOSSARY_LIMITS,
  GlossaryValidationError,
} from '../glossary/io';
import { validateGlossaryEntry } from '../glossary/validation';
import { withGlossaryLock } from '../glossary/lock';
import { DrizzleChangelogRepository } from '../db/changelog-repo';
import { txDb } from '../db/connection';
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
 */
export async function defineGlossary(
  ctx: EmberdeckContext,
  input: DefineGlossaryInput,
): Promise<DefineGlossaryResult> {
  if (!input.entries || input.entries.length === 0) {
    throw new GlossaryValidationError('entries must contain at least one entry');
  }
  if (input.entries.length > 50) {
    throw new GlossaryValidationError('entries exceeds max 50 per call');
  }

  // Validate all entries before acquiring lock (fail fast)
  for (const entry of input.entries) {
    validateGlossaryEntry(entry);
  }

  return withGlossaryLock(ctx, () => {
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
  });
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
 */
export function lookupGlossary(
  ctx: EmberdeckContext,
  word?: string,
): LookupGlossaryResult {
  const entries = readGlossary(ctx);

  if (word !== undefined) {
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
 */
export async function removeGlossary(
  ctx: EmberdeckContext,
  word: string,
): Promise<RemoveGlossaryResult> {
  if (!word || word.length === 0) {
    throw new GlossaryValidationError('word must not be empty');
  }

  return withGlossaryLock(ctx, () => {
    const entries = readGlossary(ctx);
    const idx = entries.findIndex((e) => e.word === word);
    if (idx === -1) {
      throw new GlossaryValidationError(`glossary word "${word}" not found`);
    }

    entries.splice(idx, 1);
    writeGlossary(ctx, entries);

    // Scan all cards for references to the removed word
    const allCards = ctx.cardRepo.list();
    const affectedCardKeys: string[] = [];
    for (const card of allCards) {
      const glossaryJson = parseGlossaryJson(card);
      if (glossaryJson.includes(word)) {
        affectedCardKeys.push(card.key);
      }
    }

    return { removed: word, affectedCardKeys };
  });
}

// ── rename_glossary ──────────────────────────────────────────────────────

export interface RenameGlossaryResult {
  renamedFrom: string;
  renamedTo: string;
  definition: string;
  cardsUpdated: number;
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

  return withGlossaryLock(ctx, async () => {
    const entries = readGlossary(ctx);
    const oldEntry = entries.find((e) => e.word === oldWord);
    if (!oldEntry) {
      throw new GlossaryValidationError(`glossary word "${oldWord}" not found`);
    }
    if (entries.some((e) => e.word === newWord)) {
      throw new GlossaryValidationError(`glossary word "${newWord}" already exists`);
    }

    // Collect affected cards before any mutation
    const allCards = ctx.cardRepo.list();
    const affectedCards: CardRow[] = [];
    for (const card of allCards) {
      const glossaryJson = parseGlossaryJson(card);
      if (glossaryJson.includes(oldWord)) {
        affectedCards.push(card);
      }
    }

    // Write glossary.yaml FIRST (file before DB — if this fails, nothing changed)
    const originalEntries = entries.map((e) => ({ ...e }));
    oldEntry.word = newWord;
    if (definition !== undefined) oldEntry.definition = definition;
    const finalDefinition = oldEntry.definition;

    writeGlossary(ctx, entries);

    // DB transaction: update all affected cards' glossary_json
    try {
      if (affectedCards.length > 0) {
        const now = new Date().toISOString();
        ctx.db.transaction((tx) => {
          const d = txDb(tx);
          const changelogRepo = new DrizzleChangelogRepository(d);

          for (const card of affectedCards) {
            const glossary = parseGlossaryJson(card);
            const updated = glossary.map((w: string) => (w === oldWord ? newWord : w));
            ctx.db.$client.prepare(
              'UPDATE card SET glossary_json = ?, updated_at = ? WHERE key = ?',
            ).run(JSON.stringify(updated), now, card.key);

            changelogRepo.insert({
              cardKey: card.key,
              field: 'glossary',
              oldValue: oldWord,
              newValue: newWord,
              changedAt: now,
              changedBy: 'agent',
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
      fileWriteFailures,
    };
  });
}

// ── find_cards_by_glossary_word ───────────────────────────────────────────

export interface GlossaryCardMatch {
  key: string;
  summary: string;
}

/**
 * Find all cards that declare a specific glossary word in their glossary field.
 */
export function findCardsByGlossaryWord(
  ctx: EmberdeckContext,
  word: string,
): GlossaryCardMatch[] {
  const allCards = ctx.cardRepo.list();
  const matches: GlossaryCardMatch[] = [];
  for (const card of allCards) {
    const glossary = parseGlossaryJson(card);
    if (glossary.includes(word)) {
      matches.push({ key: card.key, summary: card.summary });
    }
  }
  return matches;
}

// ── reset ─────────────────────────────────────────────────────────────────

export interface ResetResult {
  cardsDeleted: number;
  glossaryCleared: boolean;
  dbReset: boolean;
}

/**
 * Reset all emberdeck state: delete all cards (DB + files), clear glossary.yaml.
 * @spec annotations in source are NOT removed — run writeSpecAnnotations after reset to reconcile.
 */
export async function resetEmberdeck(
  ctx: EmberdeckContext,
): Promise<ResetResult> {
  const allCards = ctx.cardRepo.list();
  let cardsDeleted = 0;

  // Delete all card files + DB entries
  for (const card of allCards) {
    try {
      ctx.cardRepo.deleteByKey(card.key);
      try { await Bun.file(card.filePath).exists() && await import('node:fs/promises').then(fs => fs.unlink(card.filePath)); } catch { /* best-effort */ }
      cardsDeleted++;
    } catch { /* skip */ }
  }

  // Prune orphan tags
  ctx.classificationRepo.pruneOrphans();

  // Clear glossary
  let glossaryCleared = false;
  try {
    const { writeGlossary } = await import('../glossary/io');
    writeGlossary(ctx, []);
    glossaryCleared = true;
  } catch { /* skip */ }

  return { cardsDeleted, glossaryCleared, dbReset: true };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseGlossaryJson(card: CardRow): string[] {
  const raw = card.glossaryJson;
  if (!raw || raw === '[]') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
