/**
 * Safe parser for JSON-typed string-array columns on the card row
 * (boundaryJson, glossaryJson). Returns [] on null/empty/parse-failure —
 * these columns come from user-authored .card.md files.
 */
export function parseStringArrayJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}
