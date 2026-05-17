// Pure unit tests for validateCardGlossaryField + validateGlossaryEntry (L1).
// Moved here from test/ops/glossary.test.ts so the cap regression lives next
// to the constant it guards.
import { describe, it, expect } from 'bun:test';

import { GLOSSARY_LIMITS, GlossaryValidationError } from './io';
import { validateCardGlossaryField, validateGlossaryEntry } from './validation';

describe('validateCardGlossaryField', () => {
  const oneEntry = [{ word: 'foo', definition: 'a foo' }];

  it('accepts a single matching word', () => {
    expect(() => validateCardGlossaryField(['foo'], oneEntry)).not.toThrow();
  });

  it('rejects empty glossary array', () => {
    expect(() => validateCardGlossaryField([], oneEntry)).toThrow(GlossaryValidationError);
  });

  it('rejects duplicate words in the same card', () => {
    expect(() => validateCardGlossaryField(['foo', 'foo'], oneEntry)).toThrow(/duplicate/);
  });

  it('rejects words not present in the project glossary', () => {
    expect(() => validateCardGlossaryField(['ghost'], oneEntry)).toThrow(/not found in project glossary/);
  });

  it('rejects empty-string word', () => {
    expect(() => validateCardGlossaryField([''], oneEntry)).toThrow(/must not be empty/);
  });

  it('rejects word exceeding WORD_MAX length', () => {
    const tooLong = 'x'.repeat(GLOSSARY_LIMITS.WORD_MAX + 1);
    expect(() => validateCardGlossaryField([tooLong], oneEntry)).toThrow(/length must be 1-/);
  });

  // Regression L17: per-card cap used to be a literal `100` inline. The
  // source of truth is now GLOSSARY_LIMITS.MAX_GLOSSARY_PER_CARD; this test
  // anchors the validator to that constant.
  it('rejects more than MAX_GLOSSARY_PER_CARD entries', () => {
    const tooMany = Array.from(
      { length: GLOSSARY_LIMITS.MAX_GLOSSARY_PER_CARD + 1 },
      (_, i) => `w${i}`,
    );
    const entries = tooMany.map((w) => ({ word: w, definition: w }));
    expect(() => validateCardGlossaryField(tooMany, entries)).toThrow(/max .* entries per card/);
  });
});

describe('validateGlossaryEntry', () => {
  it('accepts a normal word + definition', () => {
    expect(() => validateGlossaryEntry({ word: 'foo', definition: 'a foo' })).not.toThrow();
  });

  it('rejects empty word', () => {
    expect(() => validateGlossaryEntry({ word: '', definition: 'd' })).toThrow(/must not be empty/);
  });

  it('rejects empty definition', () => {
    expect(() => validateGlossaryEntry({ word: 'w', definition: '' })).toThrow(/must not be empty/);
  });

  it('rejects word over WORD_MAX', () => {
    const long = 'x'.repeat(GLOSSARY_LIMITS.WORD_MAX + 1);
    expect(() => validateGlossaryEntry({ word: long, definition: 'd' })).toThrow(/exceeds maximum length/);
  });

  it('rejects definition over DEFINITION_MAX', () => {
    const long = 'x'.repeat(GLOSSARY_LIMITS.DEFINITION_MAX + 1);
    expect(() => validateGlossaryEntry({ word: 'w', definition: long })).toThrow(/exceeds maximum length/);
  });
});
