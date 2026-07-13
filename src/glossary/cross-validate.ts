// ── Glossary word matcher (analysis utility) ────────────────────────────

/**
 * Build a reusable matcher that finds glossary words in text via
 * a single compiled regex with word boundaries (case-insensitive).
 *
 * Returns a function: (text) -> Set<canonical word>.
 * Performance: O(text_length + glossary_size) -- single regex pass.
 *
 * Used by suggest_card_scope and analyze (informational, not validation).
 *
 * Known limitation: \b word boundaries do not split camelCase or snake_case
 * identifiers. "Job" will not match inside "processJob" or "job_queue".
 */
export function buildGlossaryMatcher(
  entries: Array<{ word: string }>,
): (text: string) => Set<string> {
  if (entries.length === 0) return () => new Set();

  // Map lowercase -> canonical for case-insensitive matching
  const canonMap = new Map<string, string>();
  for (const e of entries) canonMap.set(e.word.toLowerCase(), e.word);

  const escaped = entries.map((e) =>
    e.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  // Sort longest-first so multi-word terms match before their substrings
  escaped.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

  return (text: string) => {
    const found = new Set<string>();
    for (const match of text.matchAll(pattern)) {
      const canonical = canonMap.get(match[1]!.toLowerCase());
      if (canonical) found.add(canonical);
    }
    return found;
  };
}
