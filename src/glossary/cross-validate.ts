// ── Body <-> Glossary cross-validation (M6, M7) ─────────────────────────

export interface GlossaryCrossWarning {
  type: 'undeclared-usage' | 'phantom-declaration';
  word: string;
  cardKey: string;
}

/**
 * Build a reusable matcher that finds glossary words in text via
 * a single compiled regex with word boundaries (case-insensitive).
 *
 * Returns a function: (text) -> Set<canonical word>.
 * Performance: O(text_length + glossary_size) -- single regex pass.
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

/**
 * Cross-validate a card's declared glossary against its body + summary text.
 *
 * M6: glossary word found in text but not declared by this card -> undeclared-usage warning
 * M7: card declares word but it never appears in text -> phantom-declaration warning
 */
export function crossValidateGlossary(
  cardKey: string,
  body: string,
  summary: string,
  declaredGlossary: string[],
  allGlossaryEntries: Array<{ word: string }>,
): GlossaryCrossWarning[] {
  const text = `${summary}\n${body}`;
  const declaredSet = new Set(declaredGlossary);
  const matcher = buildGlossaryMatcher(allGlossaryEntries);
  const foundInText = matcher(text);

  const warnings: GlossaryCrossWarning[] = [];

  // M6: glossary word found in text but not declared by this card
  for (const word of foundInText) {
    if (!declaredSet.has(word)) {
      warnings.push({ type: 'undeclared-usage', word, cardKey });
    }
  }

  // M7: card declares word but it never appears in text
  for (const word of declaredGlossary) {
    if (!foundInText.has(word)) {
      warnings.push({ type: 'phantom-declaration', word, cardKey });
    }
  }

  return warnings;
}
