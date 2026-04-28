/**
 * Domain card validation.
 *
 * Structured body lives at frontmatter.domain namespace.
 * Field-level shape validation happens in markdown.ts:normalizeDomainBody.
 * This module is the activation-time check (mirrors principle/validate).
 *
 * Cross-domain dependency target validation requires DB access and lives in
 * src/card/validation.ts:validateActivationGuard. This file is intentionally
 * pure (no ctx) so it can be reused outside the activation pipeline.
 */

import type { CardFrontmatter } from '../card/types';
import { CardValidationError } from '../card/errors';

/**
 * Validate that a domain card has a non-empty domain namespace.
 *
 * @throws {CardValidationError} when domain namespace is missing or empty.
 */
export function validateDomainCard(fm: CardFrontmatter): void {
  if (fm.type !== 'domain') {
    throw new CardValidationError(`Expected domain card, got "${fm.type}"`);
  }
  if (!fm.domain) {
    throw new CardValidationError(
      'Domain card is missing required `domain` namespace in frontmatter',
    );
  }
  if (!fm.domain.overview || !fm.domain.overview.trim()) {
    throw new CardValidationError('domain.overview must be non-empty');
  }
  if (!fm.domain.scope || !fm.domain.scope.trim()) {
    throw new CardValidationError('domain.scope must be non-empty');
  }
  if (fm.domain.cross_domain_dependencies) {
    for (const dep of fm.domain.cross_domain_dependencies) {
      if (!dep.domain || !dep.domain.trim()) {
        throw new CardValidationError(
          'domain.cross_domain_dependencies[].domain must be a non-empty card key',
        );
      }
      if (!dep.relationship || !dep.relationship.trim()) {
        throw new CardValidationError(
          `domain.cross_domain_dependencies["${dep.domain}"].relationship must be non-empty`,
        );
      }
      if (dep.domain === fm.key) {
        throw new CardValidationError(
          `domain.cross_domain_dependencies["${dep.domain}"] is a self-reference`,
        );
      }
    }
  }
}
