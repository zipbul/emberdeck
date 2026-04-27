/**
 * Shared safe parsers for JSON-typed columns on the card row.
 * All return [] / null on parse failure rather than throwing — these columns
 * are populated from user-authored .card.md files which can be malformed.
 */

export function parseBoundaryJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function parseGlossaryJson(json: string | null | undefined): string[] {
  if (!json || json === '[]') return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}
