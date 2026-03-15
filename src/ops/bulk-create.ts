import type { EmberdeckContext } from '../config';
import type { CreateCardInput } from './create';
import { createCard } from './create';

/**
 * Result of a bulk card creation operation.
 */
export interface BulkCreateResult {
  /** Number of successfully created cards. */
  created: number;
  /** Number of failed card creations. */
  failed: number;
  /** Successfully created card keys. */
  keys: string[];
  /** Error details for each failed card. */
  errors: Array<{ slug: string; message: string }>;
}

/**
 * Create multiple cards at once.
 *
 * Processing order:
 * 1. Create all cards without relations first.
 * 2. Update relations for all cards that had them.
 *
 * This ensures intra-batch relations (card A depends-on card B,
 * where both are in the same batch) resolve regardless of array order.
 *
 * Failed items are skipped; remaining items continue (partial success).
 *
 * @param ctx - EmberdeckContext from setupEmberdeck()
 * @param inputs - Array of card inputs (same schema as createCard)
 * @returns Summary with created count, failed count, keys, and errors
 */
export async function bulkCreateCards(
  ctx: EmberdeckContext,
  inputs: CreateCardInput[],
): Promise<BulkCreateResult> {
  const keys: string[] = [];
  const errors: Array<{ slug: string; message: string }> = [];

  // Phase 1: Create all cards without relations
  const pendingRelations: Array<{ key: string; input: CreateCardInput }> = [];

  for (const input of inputs) {
    const { relations, ...rest } = input;
    try {
      const result = await createCard(ctx, rest);
      keys.push(result.fullKey);
      if (relations && relations.length > 0) {
        pendingRelations.push({ key: result.fullKey, input });
      }
    } catch (err) {
      errors.push({
        slug: input.slug,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 2: Apply relations for successfully created cards
  if (pendingRelations.length > 0) {
    const { updateCard } = await import('../ops/update');
    for (const { key, input } of pendingRelations) {
      try {
        await updateCard(ctx, key, { relations: input.relations });
      } catch (err) {
        // Relation failure does not remove the card, but is reported
        errors.push({
          slug: key,
          message: `relation update failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        // Remove from keys since it's partially failed
        const idx = keys.indexOf(key);
        if (idx !== -1) keys.splice(idx, 1);
      }
    }
  }

  return {
    created: keys.length,
    failed: errors.length,
    keys,
    errors,
  };
}
