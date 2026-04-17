import { GLOSSARY_LIMITS, GlossaryValidationError } from './io';
import type { GlossaryEntry } from './io';

/**
 * Validate a single glossary entry (word + definition limits).
 */
export function validateGlossaryEntry(entry: { word: string; definition: string }): void {
  if (!entry.word || entry.word.length === 0) {
    throw new GlossaryValidationError('glossary word must not be empty');
  }
  if (entry.word.length > GLOSSARY_LIMITS.WORD_MAX) {
    throw new GlossaryValidationError(
      `glossary word exceeds maximum length of ${GLOSSARY_LIMITS.WORD_MAX} characters (got ${entry.word.length})`,
    );
  }
  if (!entry.definition || entry.definition.length === 0) {
    throw new GlossaryValidationError('glossary definition must not be empty');
  }
  if (entry.definition.length > GLOSSARY_LIMITS.DEFINITION_MAX) {
    throw new GlossaryValidationError(
      `glossary definition exceeds maximum length of ${GLOSSARY_LIMITS.DEFINITION_MAX} characters (got ${entry.definition.length})`,
    );
  }
}

/**
 * Validate the glossary field on a card against the glossary entries.
 * Only called when the glossary field is explicitly provided (not undefined).
  * @spec glossary-management/glossary-ops
 */
export function validateCardGlossaryField(
  glossary: string[],
  glossaryEntries: GlossaryEntry[],
): void {
  if (glossary.length === 0) {
    throw new GlossaryValidationError('glossary must contain at least one entry');
  }
  if (glossary.length > 100) {
    throw new GlossaryValidationError(`glossary exceeds max 100 entries per card`);
  }
  const seen = new Set<string>();
  for (const word of glossary) {
    if (!word || word.length === 0) {
      throw new GlossaryValidationError('glossary word must not be empty');
    }
    if (word.length > GLOSSARY_LIMITS.WORD_MAX) {
      throw new GlossaryValidationError(
        `glossary word length must be 1-${GLOSSARY_LIMITS.WORD_MAX}`,
      );
    }
    if (seen.has(word)) {
      throw new GlossaryValidationError(`duplicate glossary word: "${word}"`);
    }
    seen.add(word);
    if (!glossaryEntries.some((e) => e.word === word)) {
      throw new GlossaryValidationError(`glossary word "${word}" not found in project glossary`);
    }
  }
}
