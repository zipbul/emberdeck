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

import type { DomainBody } from '../card/types';
import { CardValidationError } from '../card/errors';

/**
 * Validate that a domain card has a non-empty domain namespace.
 *
 * Takes only the fields it actually inspects (the namespace body + the card's
 * own key for self-reference detection). Callers no longer need to fabricate
 * a CardFrontmatter envelope.
 *
 * @throws {CardValidationError} when the namespace is missing, empty, or
 *   references the card's own key in cross_domain_dependencies.
 * @spec card-model/schema-and-validation/validate-card-input
 */
export function validateDomainCard(
  domain: DomainBody | undefined,
  opts: { selfKey?: string } = {},
): void {
  if (!domain) {
    throw new CardValidationError(
      'Domain card is missing required `domain` namespace in frontmatter',
    );
  }
  if (!domain.overview || !domain.overview.trim()) {
    throw new CardValidationError('domain.overview must be non-empty');
  }
  if (!domain.scope || !domain.scope.trim()) {
    throw new CardValidationError('domain.scope must be non-empty');
  }
  if (domain.cross_domain_dependencies) {
    for (const dep of domain.cross_domain_dependencies) {
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
      if (opts.selfKey && dep.domain === opts.selfKey) {
        throw new CardValidationError(
          `domain.cross_domain_dependencies["${dep.domain}"] is a self-reference`,
        );
      }
    }
  }
}
