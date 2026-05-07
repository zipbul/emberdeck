/**
 * True if `path` matches any of `patterns` (Bun.Glob semantics).
 * Empty pattern list → false.
 */
export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (new Bun.Glob(p).match(path)) return true;
  }
  return false;
}
