import { errorMessage } from '../util/error';
import type { EmberdeckContext } from '../config';
import type { CreateCardInput } from './create';
import { createCard } from './create';

/**
 * Result of a bulk card creation operation.
 *
 * Schema: per §1.7 spec card cli-surface/command-routing-and-output/commands/bulk-create.
 * `created` and `errors` are arrays (not counters) so callers can identify which
 * input failed and retry. `input_index` is the position in the original inputs
 * array (0-based); topologicalSort reorders inputs internally but input_index
 * is preserved via an internal augmentation.
 */
export interface BulkCreateResult {
  /** Successfully created cards (in arbitrary order). */
  created: Array<{ input_index: number; key: string; filePath: string }>;
  /** Cards created but whose relation update failed — exist in DB without intended relations. */
  partialKeys: string[];
  /** Failures, one entry per failed input (Phase 1 create OR Phase 2 relation update). */
  errors: Array<{ input_index: number; key?: string; filePath?: string; message: string }>;
}

/**
 * Topologically sort cards so parents are created before children.
 * Cards without parents come first.
 */
/** Internal: tracks original input position through topological reorder. */
type IndexedInput = CreateCardInput & { __inputIndex: number };

function topologicalSort(inputs: IndexedInput[]): IndexedInput[] {
  const keySet = new Set(inputs.map((i) => i.key));
  const noParent: IndexedInput[] = [];
  const withParent: IndexedInput[] = [];

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
 * @returns Summary with created count, failed count, keys, and errors
  * @spec card-lifecycle/mutation-workflows/delete-rename-bulk
 */
export async function bulkCreateCards(
  ctx: EmberdeckContext,
  inputs: CreateCardInput[],
): Promise<BulkCreateResult> {
  const indexed: IndexedInput[] = inputs.map((it, i) => ({ ...it, __inputIndex: i }));
  const created: Array<{ input_index: number; key: string; filePath: string }> = [];
  const errors: BulkCreateResult['errors'] = [];
  // Topologically sort by parent dependency (input_index travels with each item).
  const sorted = topologicalSort(indexed);

  // Phase 1: Create all cards without relations
  const pendingRelations: Array<{ key: string; filePath: string; input: IndexedInput }> = [];

  for (const input of sorted) {
    const { relations, __inputIndex, ...rest } = input;
    try {
      const result = await createCard(ctx, rest);
      created.push({ input_index: __inputIndex, key: result.fullKey, filePath: result.filePath });
      if (relations && relations.length > 0) {
        pendingRelations.push({ key: result.fullKey, filePath: result.filePath, input });
      }
    } catch (err) {
      errors.push({
        input_index: __inputIndex,
        key: input.key,
        message: errorMessage(err),
      });
    }
  }

  // Phase 2: Apply relations for successfully created cards.
  const partialKeys: string[] = [];
  if (pendingRelations.length > 0) {
    const { updateCard } = await import('../ops/update');
    for (const { key, filePath, input } of pendingRelations) {
      try {
        await updateCard(ctx, key, { relations: input.relations });
      } catch (err) {
        errors.push({
          input_index: input.__inputIndex,
          key,
          filePath,
          message: `relation update failed: ${errorMessage(err)}`,
        });
        const idx = created.findIndex((c) => c.key === key);
        if (idx !== -1) created.splice(idx, 1);
        partialKeys.push(key);
      }
    }
  }

  return {
    created,
    partialKeys,
    errors,
  };
}
