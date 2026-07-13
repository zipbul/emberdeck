/**
 * Principle card validation.
 *
 * Principle structured body lives at frontmatter.principle namespace.
 * Validation is enforced at parse time (markdown.ts normalizePrincipleBody).
 * This module adds the activation-time check that the namespace exists.
 */

import type { PrincipleBody } from '../card/types';
import { CardValidationError } from '../card/errors';

/**
 * Validate that a principle card has a usable structured body.
 *
 * Takes only the namespace it actually inspects; callers no longer need to
 * fabricate a CardFrontmatter envelope just to satisfy a type. The "type
 * must be principle" check moved to the caller side, where the discriminant
 * is already known.
 *
 * @throws {CardValidationError} when the namespace is missing or invalid.
 */
export function validatePrincipleCard(principle: PrincipleBody | undefined): void {
  if (!principle) {
    throw new CardValidationError(
      'Principle card is missing required `principle` namespace in frontmatter',
    );
  }
  if (Array.isArray(principle.applies_to) && principle.applies_to.length === 0) {
    throw new CardValidationError(
      'principle.applies_to must be "*" or non-empty array',
    );
  }
}
