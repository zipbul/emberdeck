/**
 * Run `fn` over `items` in batches of `batchSize`, yielding each settled result
 * paired with its input item. Caller decides what to do with rejected results.
 *
 * Why batches: bounding parallelism prevents file-handle/connection exhaustion
 * for large input arrays. `Promise.allSettled` keeps a single rejection from
 * cancelling the rest of the batch.
 */
export async function* batchedAllSettled<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): AsyncGenerator<{ item: T; result: PromiseSettledResult<R> }> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(fn));
    for (let j = 0; j < results.length; j++) {
      yield { item: batch[j]!, result: results[j]! };
    }
  }
}
