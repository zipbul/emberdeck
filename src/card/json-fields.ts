/**
 * Shared safe parsers for JSON-typed columns on the card row.
 * Returns [] on null/empty/parse-failure — these columns come from
 * user-authored .card.md files which can be malformed.
 */

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export const parseBoundaryJson = parseStringArray;
export const parseGlossaryJson = parseStringArray;
