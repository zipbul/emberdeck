/**
 * Safe parser for JSON-typed string-array columns on the card row
 * (currently `glossaryJson`). Returns [] on null/empty/parse-failure —
 * these columns come from user-authored card files.
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
  /** [v18] free-text original preserved when relationship is enum-narrowed. */
  note?: string;
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

/**
 * Serialize the principle/domain/brief/spec namespace blocks from a card
 * frontmatter into the JSON shape stored on the row. Returns null when no
 * namespace is present (plain markdown card).
 */
export function serializeNamespaces(fm: {
  principle?: unknown;
  domain?: unknown;
  brief?: unknown;
  spec?: unknown;
}): string | null {
  const ns: Record<string, unknown> = {};
  if (fm.principle) ns.principle = fm.principle;
  if (fm.domain) ns.domain = fm.domain;
  if (fm.brief) ns.brief = fm.brief;
  if (fm.spec) ns.spec = fm.spec;
  return Object.keys(ns).length === 0 ? null : JSON.stringify(ns);
}

/**
 * Inverse of `serializeNamespaces`. Returns an empty object when the input
 * is null, empty, or malformed.
 */
export function parseNamespaces(
  namespacesJson: string | null,
): { principle?: unknown; domain?: unknown; brief?: unknown; spec?: unknown } {
  if (!namespacesJson) return {};
  try {
    return JSON.parse(namespacesJson);
  } catch {
    return {};
  }
}
