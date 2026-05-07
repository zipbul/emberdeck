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

export interface CrossDomainDependency {
  domain: string;
  relationship?: string;
}

/**
 * Read `domain.cross_domain_dependencies` from a card's namespacesJson.
 * Returns [] for non-domain cards / null input / malformed JSON.
 */
export function parseCrossDomainDependencies(namespacesJson: string | null | undefined): CrossDomainDependency[] {
  if (!namespacesJson) return [];
  try {
    const ns = JSON.parse(namespacesJson) as { domain?: { cross_domain_dependencies?: CrossDomainDependency[] } };
    return ns.domain?.cross_domain_dependencies ?? [];
  } catch {
    return [];
  }
}
