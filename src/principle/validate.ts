/**
 * Principle card validation.
 *
 * Principle structured body lives at frontmatter.principle namespace.
 * Validation is enforced at parse time (markdown.ts normalizePrincipleBody).
 * This module adds the activation-time check that the namespace exists.
 */

import type { CardFrontmatter } from '../card/types';
import { CardValidationError } from '../card/errors';

/**
 * Validate that a principle card has the principle structured body present.
 * Field-level validation happens in markdown.ts during parse.
 *
 * @throws {CardValidationError} when principle namespace is missing.
  * @spec card-model/schema-and-validation/validate-card-input
 */
export function validatePrincipleCard(fm: CardFrontmatter): void {
  if (fm.type !== 'principle') {
    throw new CardValidationError(`Expected principle card, got "${fm.type}"`);
  }
  if (!fm.principle) {
    throw new CardValidationError(
      'Principle card is missing required `principle` namespace in frontmatter',
    );
  }
  if (Array.isArray(fm.principle.applies_to) && fm.principle.applies_to.length === 0) {
    throw new CardValidationError(
      'principle.applies_to must be "*" or non-empty array',
    );
  }
}
