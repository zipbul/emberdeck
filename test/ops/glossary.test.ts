import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';

import {
  defineGlossary,
  lookupGlossary,
  removeGlossary,
  renameGlossary,
  readGlossary,
  writeGlossary,
  glossaryFilePath,
  GlossaryValidationError,
  GlossaryParseError,
  buildGlossaryMatcher,

  findCardsByGlossaryWord,
  resetEmberdeck,
  createCard,
  updateCard,
  getCard,
  listCards,
  validateCards,
  exportCardToFile,
  syncCardFromFile,
  checkDrift,
  preChangeCheck,
  analyze,
  parseCardMarkdown,
  serializeCardMarkdown,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('Glossary', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Glossary I/O ──────────────────────────────────────────────────────

  describe('I/O', () => {
    it('should return empty array when glossary.yaml does not exist', async () => {
      tc = await createTestContext();
      expect(readGlossary(tc.ctx)).toEqual([]);
    });

    it('should return empty array when glossary.yaml is empty', async () => {
      tc = await createTestContext();
      writeFileSync(glossaryFilePath(tc.ctx), '', 'utf-8');
      expect(readGlossary(tc.ctx)).toEqual([]);
    });

    it('should throw GlossaryParseError on malformed YAML', async () => {
      tc = await createTestContext();
      writeFileSync(glossaryFilePath(tc.ctx), '{{invalid yaml', 'utf-8');
      expect(() => readGlossary(tc.ctx)).toThrow(GlossaryParseError);
    });

    it('should throw GlossaryParseError when YAML is not an array', async () => {
      tc = await createTestContext();
      writeFileSync(glossaryFilePath(tc.ctx), 'word: Job\ndefinition: work', 'utf-8');
      expect(() => readGlossary(tc.ctx)).toThrow(GlossaryParseError);
    });

    it('should create glossary.yaml on first define_glossary call', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'A unit of work' }] });
      expect(existsSync(glossaryFilePath(tc.ctx))).toBe(true);
    });

    it('should write entries sorted alphabetically', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, {
        entries: [
          { word: 'Zebra', definition: 'Z animal' },
          { word: 'Alpha', definition: 'A thing' },
        ],
      });
      const entries = readGlossary(tc.ctx);
      expect(entries[0]!.word).toBe('Alpha');
      expect(entries[1]!.word).toBe('Zebra');
    });

    it('should write empty file when all entries removed', async () => {
      tc = await createTestContext();
      writeGlossary(tc.ctx, []);
      expect(readGlossary(tc.ctx)).toEqual([]);
    });
  });

  // ── buildGlossaryMatcher ──────────────────────────────────────────────

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
      // Regex special chars are escaped — no regex error thrown
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

  // ── define_glossary ───────────────────────────────────────────────────

  describe('defineGlossary', () => {
    it('should create multiple words in one call', async () => {
      tc = await createTestContext();
      const result = await defineGlossary(tc.ctx, {
        entries: [
          { word: 'Job', definition: 'A unit of work' },
          { word: 'Worker', definition: 'Executes a Job' },
        ],
      });
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.action).toBe('created');
      expect(result.results[1]!.action).toBe('created');
    });

    it('should upsert existing word', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'Old def' }] });
      const result = await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'New def' }] });
      expect(result.results[0]!.action).toBe('updated');
      expect(readGlossary(tc.ctx).find(e => e.word === 'Job')!.definition).toBe('New def');
    });

    it('should reject empty entries array', async () => {
      tc = await createTestContext();
      expect(() => defineGlossary(tc.ctx, { entries: [] })).toThrow(GlossaryValidationError);
    });

    it('should reject word exceeding max length', async () => {
      tc = await createTestContext();
      expect(() => defineGlossary(tc.ctx, {
        entries: [{ word: 'x'.repeat(101), definition: 'too long' }],
      })).toThrow(GlossaryValidationError);
    });

    it('should reject definition exceeding max length', async () => {
      tc = await createTestContext();
      expect(() => defineGlossary(tc.ctx, {
        entries: [{ word: 'ok', definition: 'x'.repeat(1001) }],
      })).toThrow(GlossaryValidationError);
    });

    it('should reject entire batch when one entry invalid (all-or-nothing)', async () => {
      tc = await createTestContext();
      expect(() => defineGlossary(tc.ctx, {
        entries: [
          { word: 'Good', definition: 'valid' },
          { word: '', definition: 'bad word' },  // invalid
        ],
      })).toThrow(GlossaryValidationError);
      // Nothing should be written
      expect(readGlossary(tc.ctx)).toEqual([]);
    });

    it('should reject when total exceeds MAX_ENTRIES', async () => {
      tc = await createTestContext();
      for (let batch = 0; batch < 10; batch++) {
        await defineGlossary(tc.ctx, {
          entries: Array.from({ length: 50 }, (_, i) => ({
            word: `B${batch}_W${i}`, definition: `D${i}`,
          })),
        });
      }
      expect(() => defineGlossary(tc.ctx, {
        entries: [{ word: 'OneMore', definition: 'over limit' }],
      })).toThrow(/exceed/);
    });
  });

  // ── lookup_glossary ───────────────────────────────────────────────────

  describe('lookupGlossary', () => {
    it('should find exact match (case-sensitive)', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      expect(lookupGlossary(tc.ctx, 'Job').found).toBe(true);
    });

    it('should not find case-mismatched word', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      expect(lookupGlossary(tc.ctx, 'job').found).toBe(false);
    });

    it('should return all entries when no word provided', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, {
        entries: [{ word: 'A', definition: 'a' }, { word: 'B', definition: 'b' }],
      });
      expect(lookupGlossary(tc.ctx).entries).toHaveLength(2);
    });
  });

  // ── remove_glossary ───────────────────────────────────────────────────

  describe('removeGlossary', () => {
    it('should remove existing word', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await removeGlossary(tc.ctx, 'Job');
      expect(readGlossary(tc.ctx)).toHaveLength(0);
    });

    it('should reject nonexistent word', async () => {
      tc = await createTestContext();
      expect(() => removeGlossary(tc.ctx, 'Nope')).toThrow(/not found/);
    });

    it('should report affected card keys', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c1', summary: 'Job card', type: 'intent', glossary: ['Job'] });
      const result = await removeGlossary(tc.ctx, 'Job');
      expect(result.affectedCardKeys).toContain('c1');
    });
  });

  // ── rename_glossary ───────────────────────────────────────────────────

  describe('renameGlossary', () => {
    it('should rename word in glossary and update card DB + file', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'rc', summary: 'Job card', type: 'intent', glossary: ['Job'] });

      const result = await renameGlossary(tc.ctx, 'Job', 'Task');
      expect(result.cardsUpdated).toBe(1);
      expect(readGlossary(tc.ctx).some(e => e.word === 'Task')).toBe(true);
      expect(readGlossary(tc.ctx).some(e => e.word === 'Job')).toBe(false);

      // Card file should reflect new word
      const card = await getCard(tc.ctx, 'rc');
      expect(card.card.frontmatter.glossary).toContain('Task');
      expect(card.card.frontmatter.glossary).not.toContain('Job');
    });

    it('should update definition when provided', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'old' }] });
      await renameGlossary(tc.ctx, 'Job', 'Task', 'new def');
      expect(readGlossary(tc.ctx).find(e => e.word === 'Task')!.definition).toBe('new def');
    });

    it('should reject when newWord already exists', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'a' }, { word: 'Task', definition: 'b' }] });
      expect(() => renameGlossary(tc.ctx, 'Job', 'Task')).toThrow(/already exists/);
    });

    it('should reject when oldWord not found', async () => {
      tc = await createTestContext();
      expect(() => renameGlossary(tc.ctx, 'Nope', 'New')).toThrow(/not found/);
    });
  });

  // ── Card glossary validation (M1, M2, M3) ─────────────────────────────

  describe('Card validation', () => {
    it('M1: should reject create_card without glossary when glossary.yaml exists', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      expect(() => createCard(tc.ctx, { key: 'c', summary: 's', type: 'intent' }))
        .toThrow(/glossary field is required/);
    });

    it('M1: should reject create_card with empty glossary when glossary.yaml exists', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      expect(() => createCard(tc.ctx, { key: 'c', summary: 's', type: 'intent', glossary: [] }))
        .toThrow(/glossary field is required/);
    });

    it('should allow create_card without glossary when no glossary.yaml', async () => {
      tc = await createTestContext();
      const r = await createCard(tc.ctx, { key: 'c', summary: 's', type: 'intent' });
      expect(r.fullKey).toBe('c');
    });

    it('M2: should reject nonexistent glossary word on create', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      expect(() => createCard(tc.ctx, { key: 'c', summary: 's', type: 'intent', glossary: ['Nope'] }))
        .toThrow(/not found in project glossary/);
    });

    it('M3: should reject duplicate glossary entries on create', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      expect(() => createCard(tc.ctx, { key: 'c', summary: 's', type: 'intent', glossary: ['Job', 'Job'] }))
        .toThrow(/duplicate/);
    });

    it('should store glossary in DB and file on create', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      const r = await createCard(tc.ctx, { key: 'c', summary: 'Job card', type: 'intent', glossary: ['Job'] });
      expect(r.card.frontmatter.glossary).toEqual(['Job']);
      // DB row
      const row = tc.ctx.cardRepo.findByKey('c');
      expect(row!.glossaryJson).toBe('["Job"]');
    });

    it('should validate glossary on update when provided', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      expect(() => updateCard(tc.ctx, 'c', { glossary: ['Nope'] }))
        .toThrow(/not found in project glossary/);
    });

    it('should allow update without glossary field (no re-validation)', async () => {
      tc = await createTestContext();
      await createCard(tc.ctx, { key: 'c', summary: 's', type: 'intent' });
      const r = await updateCard(tc.ctx, 'c', { summary: 'new' });
      expect(r.card.frontmatter.summary).toBe('new');
    });

  });

  // ── Markdown roundtrip ────────────────────────────────────────────────

  describe('Markdown roundtrip', () => {
    it('should preserve glossary field through serialize then parse', () => {
      const fm = { key: 'k', summary: 's', status: 'draft' as const, type: 'intent' as const, glossary: ['Job', 'Worker'] };
      const parsed = parseCardMarkdown(serializeCardMarkdown(fm, '## Body'));
      expect(parsed.frontmatter.glossary).toEqual(['Job', 'Worker']);
    });

    it('should omit glossary when not set', () => {
      const fm = { key: 'k', summary: 's', status: 'draft' as const, type: 'intent' as const };
      const parsed = parseCardMarkdown(serializeCardMarkdown(fm, ''));
      expect(parsed.frontmatter.glossary).toBeUndefined();
    });
  });

  // ── Drift detection ───────────────────────────────────────────────────

  describe('Drift detection', () => {
    it('should detect glossary_broken after word removal', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', status: 'active', glossary: ['Job'] });
      await removeGlossary(tc.ctx, 'Job');
      const result = await checkDrift(tc.ctx, 'c', { autoTransition: false });
      expect(result.cards.find(c => c.key === 'c')?.driftType).toBe('glossary_broken');
    });

    it('should auto-transition active card to drifted', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', status: 'active', glossary: ['Job'] });
      await removeGlossary(tc.ctx, 'Job');
      const result = await checkDrift(tc.ctx, 'c', { autoTransition: true });
      expect(result.cards.find(c => c.key === 'c')?.status).toBe('drifted');
    });

    it('should skip draft cards', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      await removeGlossary(tc.ctx, 'Job');
      const result = await checkDrift(tc.ctx, 'c', { autoTransition: false });
      // Draft cards are excluded from drift analysis
      expect(result.cards.find(c => c.key === 'c')).toBeUndefined();
    });
  });

  // ── validate_cards ────────────────────────────────────────────────────

  describe('validateCards', () => {
    it('should report glossary-broken', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      await removeGlossary(tc.ctx, 'Job');
      const result = await validateCards(tc.ctx);
      expect(result.warnings.some(w => w.type === 'glossary-broken')).toBe(true);
    });

    it('should report glossary-unused', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'a' }, { word: 'Orphan', definition: 'b' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      const result = await validateCards(tc.ctx);
      expect(result.warnings.some(w => w.type === 'glossary-unused' && w.message.includes('Orphan'))).toBe(true);
    });

  });

  // ── Read path ─────────────────────────────────────────────────────────

  describe('Read path', () => {
    it('get_card should include glossary field', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      const result = await getCard(tc.ctx, 'c');
      expect(result.card.frontmatter.glossary).toEqual(['Job']);
    });

    it('list_cards should include glossaryJson in response', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      const rows = listCards(tc.ctx);
      const row = rows.find(r => r.key === 'c');
      expect(row!.glossaryJson).toBe('["Job"]');
    });

    it('export_card_to_file should include glossary in frontmatter', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      await exportCardToFile(tc.ctx, 'c');
      const card = await getCard(tc.ctx, 'c');
      expect(card.card.frontmatter.glossary).toEqual(['Job']);
    });

    it('sync_card_from_file should parse glossary into DB', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      // Re-sync from file
      const row = tc.ctx.cardRepo.findByKey('c');
      await syncCardFromFile(tc.ctx, row!.filePath);
      const reloaded = tc.ctx.cardRepo.findByKey('c');
      expect(reloaded!.glossaryJson).toBe('["Job"]');
    });

    it('cards with empty glossary_json should not have glossary field', async () => {
      tc = await createTestContext();
      await createCard(tc.ctx, { key: 'c', summary: 's', type: 'intent' });
      const result = await getCard(tc.ctx, 'c');
      expect(result.card.frontmatter.glossary).toBeUndefined();
    });
  });

  // ── Integration (pre_change_check, analyze) ───────────────────────────

  describe('Integration', () => {
    it('pre_change_check should include glossary entries (M8)', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      const result = preChangeCheck(tc.ctx, ['src/foo.ts']);
      expect(result.glossary).toBeDefined();
      expect(result.glossary!.some(e => e.word === 'Job')).toBe(true);
    });

    it('pre_change_check should omit glossary when empty', async () => {
      tc = await createTestContext();
      const result = preChangeCheck(tc.ctx, ['src/foo.ts']);
      expect(result.glossary).toBeUndefined();
    });

    it('analyze should include glossary stats', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'a' }, { word: 'Orphan', definition: 'b' }] });
      await createCard(tc.ctx, { key: 'c', summary: 'Job', type: 'intent', glossary: ['Job'] });
      const result = await analyze(tc.ctx);
      expect(result.glossary.totalWords).toBe(2);
      expect(result.glossary.unusedWords).toContain('Orphan');
      expect(result.glossary.entries).toHaveLength(2);
    });
  });

  // ── findCardsByGlossaryWord ─────────────────────────────────────────

  describe('findCardsByGlossaryWord', () => {
    it('should find cards declaring a specific glossary word', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'a' }, { word: 'Worker', definition: 'b' }] });
      await createCard(tc.ctx, { key: 'c1', summary: 'Job card', type: 'intent', glossary: ['Job'] });
      await createCard(tc.ctx, { key: 'c2', summary: 'Both card', type: 'intent', glossary: ['Job', 'Worker'] });
      await createCard(tc.ctx, { key: 'c3', summary: 'Worker card', type: 'intent', glossary: ['Worker'] });

      const jobCards = findCardsByGlossaryWord(tc.ctx, 'Job');
      expect(jobCards).toHaveLength(2);
      expect(jobCards.map(c => c.key).sort()).toEqual(['c1', 'c2']);

      const workerCards = findCardsByGlossaryWord(tc.ctx, 'Worker');
      expect(workerCards).toHaveLength(2);
      expect(workerCards.map(c => c.key).sort()).toEqual(['c2', 'c3']);
    });

    it('should return empty array for unknown word', async () => {
      tc = await createTestContext();
      expect(findCardsByGlossaryWord(tc.ctx, 'Nope')).toEqual([]);
    });
  });

  // ── resetEmberdeck ──────────────────────────────────────────────────

  describe('resetEmberdeck', () => {
    it('should delete all cards and clear glossary', async () => {
      tc = await createTestContext();
      await defineGlossary(tc.ctx, { entries: [{ word: 'Job', definition: 'work' }] });
      await createCard(tc.ctx, { key: 'c1', summary: 'Job', type: 'intent', glossary: ['Job'] });
      await createCard(tc.ctx, { key: 'c2', summary: 'Job 2', type: 'intent', glossary: ['Job'] });

      const result = await resetEmberdeck(tc.ctx);
      expect(result.cardsDeleted).toBe(2);
      expect(result.glossaryCleared).toBe(true);

      // DB should be empty
      expect(tc.ctx.cardRepo.list()).toHaveLength(0);
      // Glossary should be empty
      expect(readGlossary(tc.ctx)).toEqual([]);
    });

    it('should succeed on empty state', async () => {
      tc = await createTestContext();
      const result = await resetEmberdeck(tc.ctx);
      expect(result.cardsDeleted).toBe(0);
      expect(result.glossaryCleared).toBe(true);
    });
  });
});
