/**
 * Distinct error class for "glossary word not found" lookups (split from the
 * catch-all GlossaryValidationError so the CLI can map it to exit 3, matching
 * the rest of the not-found family).
 */
export class GlossaryNotFoundError extends Error {
  constructor(word: string) {
    super(`glossary word "${word}" not found`);
    this.name = 'GlossaryNotFoundError';
  }
}
