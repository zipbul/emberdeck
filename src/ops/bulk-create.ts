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
 * @spec card-crud
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

  // Phase 2: Apply relations for successfully created cards.
  // We collect ALL declared relations first, then apply them per card in one shot.
  // This prevents mutual relations (A→B + B→A) from overwriting each other's reverse mirrors.
  if (pendingRelations.length > 0) {
    // Build a merged relation map: cardKey → all forward relations it should own
    const relationMap = new Map<string, Array<{ type: string; target: string }>>();
    for (const { key, input } of pendingRelations) {
      if (input.relations) {
        relationMap.set(key, [...(relationMap.get(key) ?? []), ...input.relations]);
      }
    }

    const { updateCard } = await import('../ops/update');
    for (const [key, relations] of relationMap) {
      try {
        await updateCard(ctx, key, { relations });
      } catch (err) {
        errors.push({
          slug: key,
          message: `relation update failed: ${err instanceof Error ? err.message : String(err)}`,
        });
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
