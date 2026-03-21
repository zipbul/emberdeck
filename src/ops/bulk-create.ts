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
  errors: Array<{ key: string; message: string }>;
}

/**
 * Topologically sort cards so parents are created before children.
 * Cards without parents come first.
 */
function topologicalSort(inputs: CreateCardInput[]): CreateCardInput[] {
  const keySet = new Set(inputs.map((i) => i.key));
  const noParent: CreateCardInput[] = [];
  const withParent: CreateCardInput[] = [];

  for (const input of inputs) {
    if (!input.parent || !keySet.has(input.parent)) {
      noParent.push(input);
    } else {
      withParent.push(input);
    }
  }

  const sorted = [...noParent];
  const created = new Set(noParent.map((i) => i.key));
  const remaining = [...withParent];
  let iterations = 0;
  const maxIterations = remaining.length * remaining.length + 1;

  while (remaining.length > 0 && iterations < maxIterations) {
    iterations++;
    const idx = remaining.findIndex((i) => !i.parent || created.has(i.parent));
    if (idx === -1) break; // circular or unresolvable
    const item = remaining.splice(idx, 1)[0]!;
    sorted.push(item);
    created.add(item.key);
  }

  // Append any remaining (unresolvable) items at the end
  sorted.push(...remaining);
  return sorted;
}

/**
 * Create multiple cards at once.
 *
 * Processing order:
 * 1. Topologically sort by parent dependency (parents first).
 * 2. Create all cards without relations first.
 * 3. Update relations for all cards that had them.
 *
 * This ensures intra-batch parent references and relations resolve regardless of input order.
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
  const errors: Array<{ key: string; message: string }> = [];

  // Topologically sort by parent dependency
  const sorted = topologicalSort(inputs);

  // Phase 1: Create all cards without relations
  const pendingRelations: Array<{ key: string; input: CreateCardInput }> = [];

  for (const input of sorted) {
    const { relations, ...rest } = input;
    try {
      const result = await createCard(ctx, rest);
      keys.push(result.fullKey);
      if (relations && relations.length > 0) {
        pendingRelations.push({ key: result.fullKey, input });
      }
    } catch (err) {
      errors.push({
        key: input.key,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 2: Apply relations for successfully created cards.
  if (pendingRelations.length > 0) {
    const { updateCard } = await import('../ops/update');
    for (const { key, input } of pendingRelations) {
      try {
        await updateCard(ctx, key, { relations: input.relations });
      } catch (err) {
        errors.push({
          key,
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
