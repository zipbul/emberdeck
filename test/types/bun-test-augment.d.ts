/**
 * Module augmentation for `bun:test`.
 *
 * bun-types 1.3.x declares `expect(p).rejects` (and `.resolves`) as
 * `Matchers<unknown>`. Every Matchers method returns `void` because the
 * Matchers interface also serves the sync `expect(value)` chain. At
 * runtime, however, the chain returned by `.rejects` is a thenable — you
 * must `await` it, otherwise the rejection goes unhandled. Without
 * augmentation, every `await expect(p).rejects.toThrow(...)` emits the
 * informational diagnostic TS80007 ("'await' has no effect on the type")
 * even though it is the correct call shape.
 *
 * Adding an optional `then` to `Matchers<T>` makes the chain `PromiseLike`,
 * which is exactly what `await` requires. We make it optional (and
 * undefined at runtime on the sync chain) so the augmentation does not
 * change runtime behavior; it only opens a typing path for the async
 * chains that are already thenable.
 *
 * Why a project-level augmentation rather than upstream fix:
 *   - bun:test's `.rejects` semantics are stable; the type omission is
 *     a known cost of unifying sync + async expect chains in one Matchers
 *     interface. Jest historically had the same shape until the recent
 *     `PromisifiedMatchers` split.
 *   - A focused project augmentation costs 5 lines and resolves every
 *     `.rejects` / `.resolves` await in the suite without touching
 *     production code or rewriting ~100 call sites.
 */
declare module 'bun:test' {
  // PromiseLike<T> in lib.es5.d.ts has shape:
  //   then<TResult1, TResult2>(
  //     onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
  //     onRejected?:  ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  //   ): PromiseLike<TResult1 | TResult2>
  // Matching this signature is what lets `await` accept the Matchers chain.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<T> {
    then?<TResult1 = void, TResult2 = never>(
      onFulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2>;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface AsymmetricMatchers {
    then?<TResult1 = void, TResult2 = never>(
      onFulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2>;
  }
}

export {};
