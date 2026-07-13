import { errorMessage } from '../util/error';
import type { EmberdeckContext } from '../config';
import type { CreateCardInput } from './create';
import { createCard } from './create';
import { updateCard } from './update';

/**
 * Result of a bulk card creation operation.
 *
 * Counters (`created`/`failed` numbers) are derivable from the arrays
 * (`created.length`/`errors.length`) — only the structured arrays are stored.
 */
export interface BulkCreateResult {
  /** Successfully created cards, in topologically-sorted execution order. */
  created: Array<{ inputIndex: number; key: string; filePath: string }>;
  /** Cards created in phase 1 whose phase-2 relation update failed — they
   *  exist in the DB without the intended relations. */
  partialKeys: string[];
  /** Failed inputs (validation, write, or relation-update failure). */
  errors: Array<{ inputIndex: number; key?: string; filePath?: string; message: string }>;
}

type IndexedInput = CreateCardInput & { __inputIndex: number };

/**
 * Topologically sort cards so parents are created before children.
 * Cards without parents (or whose parent is outside the batch) come first.
 */
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
 * Topological sort moves parents before children; intra-batch relations are
 * applied in a second pass. Failed items are skipped; remaining items continue.
 *
 * Duplicate keys in the input batch are processed in the order they appear;
 * the first wins, the second fails with `inputIndex` preserving its original
 * position (D13: inputIndex never collapses duplicates).
 *
 */
export async function bulkCreateCards(
  ctx: EmberdeckContext,
  inputs: CreateCardInput[],
): Promise<BulkCreateResult> {
  const indexed: IndexedInput[] = inputs.map((it, i) => ({ ...it, __inputIndex: i }));

  const created: BulkCreateResult['created'] = [];
  const errors: BulkCreateResult['errors'] = [];
  const sorted = topologicalSort(indexed);

  // Phase 1: create all cards without relations
  const pendingRelations: Array<{ key: string; filePath: string; input: IndexedInput }> = [];

  for (const input of sorted) {
    const { relations, __inputIndex, ...rest } = input;
    try {
      const result = await createCard(ctx, rest);
      created.push({ inputIndex: __inputIndex, key: result.fullKey, filePath: result.filePath });
      if (relations && relations.length > 0) {
        pendingRelations.push({ key: result.fullKey, filePath: result.filePath, input });
      }
    } catch (err) {
      errors.push({
        inputIndex: __inputIndex,
        key: input.key,
        message: errorMessage(err),
      });
    }
  }

  // Phase 2: apply relations for successfully created cards. A phase-2 failure
  // does NOT remove the entry from created[] — the row was committed in phase
  // 1 and remains on disk. Instead the failure is reported separately:
  //   - errors[] gets the relation-update message (with the same inputIndex)
  //   - partialKeys[] lists the keys whose relations did not land
  // Callers can rerun `ed card update KEY --field relations=...` to recover.
  const partialKeys: string[] = [];
  if (pendingRelations.length > 0) {
    for (const { key, filePath, input } of pendingRelations) {
      try {
        await updateCard(ctx, key, { relations: input.relations });
      } catch (err) {
        errors.push({
          inputIndex: input.__inputIndex,
          key,
          filePath,
          message: `relation update failed: ${errorMessage(err)}`,
        });
        partialKeys.push(key);
      }
    }
  }

  return { created, partialKeys, errors };
}
