// Pure unit tests for buildGlossaryMatcher (L1).
// Previously lived in test/ops/glossary.test.ts but the matcher is a pure
// regex builder with no DB/fs/ctx dependency — wrong tier.
import { describe, it, expect } from 'bun:test';

import { buildGlossaryMatcher } from './cross-validate';

describe('buildGlossaryMatcher', () => {
  it('should match case-insensitively', () => {
    const matcher = buildGlossaryMatcher([{ word: 'Job' }]);
    const found = matcher('the job queue processes tasks');
    expect(found.has('Job')).toBe(true);
  });

  it('should use word boundary to prevent substring matches', () => {
    const matcher = buildGlossaryMatcher([{ word: 'Card' }]);
    const found = matcher('CardFrontmatter is a type');
    expect(found.has('Card')).toBe(false);
  });

  it('should match word at word boundary', () => {
    const matcher = buildGlossaryMatcher([{ word: 'Card' }]);
    const found = matcher('A Card is created');
    expect(found.has('Card')).toBe(true);
  });

  it('should match multi-word terms', () => {
    const matcher = buildGlossaryMatcher([{ word: 'Code Link' }]);
    const found = matcher('Each Code Link references a symbol');
    expect(found.has('Code Link')).toBe(true);
  });

  it('should match longest first (Code Link before Code)', () => {
    const matcher = buildGlossaryMatcher([{ word: 'Code' }, { word: 'Code Link' }]);
    const found = matcher('A Code Link is essential');
    expect(found.has('Code Link')).toBe(true);
  });

  it('should handle regex special characters in words (escaped safely)', () => {
    // Regex special chars are escaped — no regex error thrown.
    const matcher = buildGlossaryMatcher([{ word: 'C++' }]);
    expect(() => matcher('some text')).not.toThrow();
    // Note: \b does not match around non-word chars like +, so C++ won't match via \b.
    // This test verifies no crash from unescaped regex, not word-boundary matching.
  });

  it('should return empty set for empty glossary', () => {
    const matcher = buildGlossaryMatcher([]);
    const found = matcher('some text');
    expect(found.size).toBe(0);
  });

  it('should be reusable across multiple texts', () => {
    const matcher = buildGlossaryMatcher([{ word: 'Job' }, { word: 'Worker' }]);
    const found1 = matcher('A Job is submitted');
    const found2 = matcher('A Worker executes it');
    expect(found1.has('Job')).toBe(true);
    expect(found1.has('Worker')).toBe(false);
    expect(found2.has('Worker')).toBe(true);
    expect(found2.has('Job')).toBe(false);
  });
});
