/**
 * Vision card validation.
 *
 * Structured body lives at frontmatter.vision namespace. Field-shape parsing
 * happens in card/serialize.ts:normalizeVisionBody. This module is the
 * activation-time structural check (mirrors principle/validate, domain/validate).
 *
 * vision is enforcement-free (no applies_to/enforcement) but still structurally
 * validated like every card: all three fields must be non-empty prose. The
 * singleton (≤1 per project) and root-only rules are enforced cross-card in
 * ops/sync/validate.ts and at write time in card/validation.ts respectively.
 *
 */

import type { VisionBody } from '../card/types';
import { CardValidationError } from '../card/errors';

/**
 * Validate that a vision card has a usable structured body.
 *
 * @throws {CardValidationError} when the namespace is missing or any required
 *   field is blank.
 */
export function validateVisionCard(vision: VisionBody | undefined): void {
  if (!vision) {
    throw new CardValidationError(
      'Vision card is missing required `vision` namespace in frontmatter',
    );
  }
  if (typeof vision.statement !== 'string' || !vision.statement.trim()) {
    throw new CardValidationError('vision.statement must be non-empty');
  }
  if (typeof vision.rationale !== 'string' || !vision.rationale.trim()) {
    throw new CardValidationError('vision.rationale must be non-empty');
  }
  if (typeof vision.success_direction !== 'string' || !vision.success_direction.trim()) {
    throw new CardValidationError('vision.success_direction must be non-empty');
  }
}
