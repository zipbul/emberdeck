import jsyaml from 'js-yaml';
import { errorMessage } from '../util/error';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import { atomicWriteSync } from '../fs/writer';

// ── Types ────────────────────────────────────────────────────────────────

export interface GlossaryEntry {
  word: string;
  definition: string;
}

// ── Constants ────────────────────────────────────────────────────────────

export const GLOSSARY_LIMITS = {
  /** Max characters per word */
  WORD_MAX: 100,
  /** Max characters per definition */
  DEFINITION_MAX: 1000,
  /** Max total glossary entries */
  MAX_ENTRIES: 500,
  /** Max entries per single defineGlossary call (batch limit) */
  MAX_ENTRIES_PER_CALL: 50,
  /** Max glossary words declared on a single card */
  MAX_GLOSSARY_PER_CARD: 100,
} as const;

// ── Errors ───────────────────────────────────────────────────────────────

export class GlossaryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlossaryParseError';
  }
}

export class GlossaryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlossaryValidationError';
  }
}

// ── File path ────────────────────────────────────────────────────────────

/**
 * Returns the path to glossary.yaml.
 * Located in the .emberdeck/ directory (parent of cardsDir).
 */
export function glossaryFilePath(ctx: EmberdeckContext): string {
  return join(dirname(ctx.cardsDir), 'glossary.yaml');
}

// ── Read ─────────────────────────────────────────────────────────────────

/**
 * Read and parse the glossary file.
 *
 * - File does not exist -> empty array (normal: glossary not yet created)
 * - Empty file -> empty array (normal: all entries removed)
 * - Malformed non-empty file -> throw GlossaryParseError
 */
export function readGlossary(ctx: EmberdeckContext): GlossaryEntry[] {
  const path = glossaryFilePath(ctx);
  if (!existsSync(path)) return [];

  const content = readFileSync(path, 'utf-8');
  if (content.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = jsyaml.load(content);
  } catch (err) {
    throw new GlossaryParseError(
      `Failed to parse glossary.yaml: ${errorMessage(err)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new GlossaryParseError('glossary.yaml must be a YAML array');
  }

  const entries: GlossaryEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new GlossaryParseError(`glossary.yaml entry [${i}] must be an object with word and definition`);
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.word !== 'string' || typeof obj.definition !== 'string') {
      throw new GlossaryParseError(`glossary.yaml entry [${i}] must have string word and definition`);
    }
    entries.push({ word: obj.word, definition: obj.definition });
  }

  return entries;
}

// ── Write ────────────────────────────────────────────────────────────────

/**
 * Write glossary entries to glossary.yaml.
 * Entries are sorted alphabetically by word for deterministic git diffs.
 * Uses tmp file + rename for atomic replacement (prevents truncation on
 * interrupted writes — half-written glossary is worse than a failed write).
 */
export function writeGlossary(ctx: EmberdeckContext, entries: GlossaryEntry[]): void {
  const path = glossaryFilePath(ctx);
  mkdirSync(dirname(path), { recursive: true });

  const sorted = entries.length > 0
    ? [...entries].sort((a, b) => a.word.localeCompare(b.word))
    : [];
  const yaml = sorted.length === 0 ? '' : jsyaml.dump(sorted, { lineWidth: 80, noRefs: true });

  atomicWriteSync(path, yaml);
}
