import { describe, it, expect, afterEach } from 'bun:test';

import {
  createCard,
  updateCard,
  updateCardStatus,
  verifyAcceptance,
  listUnverified,
  getCardHistory,
  listCards,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('verifyAcceptance', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should mark a single criterion as verified', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'ac-card',
      summary: 'AC test',
      acceptance: [
        { id: 'ac-1', description: 'First criterion', verified: false },
        { id: 'ac-2', description: 'Second criterion', verified: false },
      ],
    });

    const result = await verifyAcceptance(tc.ctx, 'ac-card', 'ac-1');
    expect(result.changed).toBe(1);
    expect(result.acceptance.find((a) => a.id === 'ac-1')!.verified).toBe(true);
    expect(result.acceptance.find((a) => a.id === 'ac-2')!.verified).toBe(false);
  });

  it('should mark multiple criteria as verified at once', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'multi-ac',
      summary: 'Multi AC',
      acceptance: [
        { id: 'ac-1', description: 'First', verified: false },
        { id: 'ac-2', description: 'Second', verified: false },
        { id: 'ac-3', description: 'Third', verified: false },
      ],
    });

    const result = await verifyAcceptance(tc.ctx, 'multi-ac', ['ac-1', 'ac-3']);
    expect(result.changed).toBe(2);
    expect(result.acceptance.find((a) => a.id === 'ac-1')!.verified).toBe(true);
    expect(result.acceptance.find((a) => a.id === 'ac-2')!.verified).toBe(false);
    expect(result.acceptance.find((a) => a.id === 'ac-3')!.verified).toBe(true);
  });

  it('should unverify a criterion when verified=false', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'unverify',
      summary: 'Unverify test',
      acceptance: [
        { id: 'ac-1', description: 'First', verified: true },
      ],
    });

    const result = await verifyAcceptance(tc.ctx, 'unverify', 'ac-1', false);
    expect(result.changed).toBe(1);
    expect(result.acceptance[0]!.verified).toBe(false);
  });

  it('should return changed=0 for non-existent criterion ID', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'no-match',
      summary: 'No match',
      acceptance: [{ id: 'ac-1', description: 'First', verified: false }],
    });

    const result = await verifyAcceptance(tc.ctx, 'no-match', 'ac-99');
    expect(result.changed).toBe(0);
  });

  it('should throw when card has no acceptance criteria', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-ac', summary: 'No AC' });
    expect(verifyAcceptance(tc.ctx, 'no-ac', 'ac-1')).rejects.toThrow('no acceptance criteria');
  });

  it('should throw when card does not exist', async () => {
    tc = await createTestContext();
    expect(verifyAcceptance(tc.ctx, 'nonexistent', 'ac-1')).rejects.toThrow();
  });
});

describe('listUnverified', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should list cards with unverified acceptance', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'partial',
      summary: 'Partial verification',
      acceptance: [
        { id: 'ac-1', description: 'Done', verified: true },
        { id: 'ac-2', description: 'Not done', verified: false },
      ],
    });
    await createCard(tc.ctx, {
      slug: 'complete',
      summary: 'All verified',
      acceptance: [
        { id: 'ac-1', description: 'Done', verified: true },
      ],
    });
    await createCard(tc.ctx, { slug: 'no-ac', summary: 'No acceptance' });

    const result = listUnverified(tc.ctx);
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('partial');
    expect(result[0]!.unverified).toHaveLength(1);
    expect(result[0]!.total).toBe(2);
  });

  it('should return empty array when no unverified cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'clean', summary: 'Clean' });
    expect(listUnverified(tc.ctx)).toEqual([]);
  });
});

describe('getCardHistory', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should record status changes in changelog', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'hist', summary: 'History test' });
    await updateCardStatus(tc.ctx, 'hist', 'accepted');
    await updateCardStatus(tc.ctx, 'hist', 'implementing');

    const history = getCardHistory(tc.ctx, 'hist');
    expect(history.length).toBe(2);
    const statuses = history.map((h) => h.newValue).sort();
    expect(statuses).toEqual(['accepted', 'implementing']);
  });

  it('should record field changes from updateCard', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'field-hist', summary: 'Original' });
    await updateCard(tc.ctx, 'field-hist', { summary: 'Updated' });

    const history = getCardHistory(tc.ctx, 'field-hist');
    expect(history.length).toBeGreaterThanOrEqual(1);
    const summaryChange = history.find((h) => h.field === 'summary');
    expect(summaryChange).toBeDefined();
    expect(summaryChange!.oldValue).toBe('Original');
    expect(summaryChange!.newValue).toBe('Updated');
  });

  it('should return empty array for card with no history', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-hist', summary: 'No history' });
    expect(getCardHistory(tc.ctx, 'no-hist')).toEqual([]);
  });
});

describe('updateCardStatus — acceptance warnings', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should warn when transitioning to implemented with unverified criteria', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'warn-card',
      summary: 'Warning test',
      acceptance: [
        { id: 'ac-1', description: 'Done', verified: true },
        { id: 'ac-2', description: 'Not done', verified: false },
      ],
    });
    await updateCardStatus(tc.ctx, 'warn-card', 'accepted');
    await updateCardStatus(tc.ctx, 'warn-card', 'implementing');
    const result = await updateCardStatus(tc.ctx, 'warn-card', 'implemented');

    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBe(1);
    expect(result.warnings![0]).toContain('ac-2');
  });

  it('should not warn when all criteria are verified', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'no-warn',
      summary: 'No warning',
      acceptance: [
        { id: 'ac-1', description: 'Done', verified: true },
      ],
    });
    const result = await updateCardStatus(tc.ctx, 'no-warn', 'implemented');
    expect(result.warnings).toBeUndefined();
  });

  it('should not warn when card has no acceptance criteria', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-ac-warn', summary: 'No AC' });
    const result = await updateCardStatus(tc.ctx, 'no-ac-warn', 'implemented');
    expect(result.warnings).toBeUndefined();
  });
});

describe('Phase 1 — type, priority, acceptance in create/update', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should create card with type, priority, and acceptance', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, {
      slug: 'full-p1',
      summary: 'Phase 1 card',
      type: 'feature',
      priority: 'high',
      acceptance: [
        { id: 'ac-1', description: 'Must work', verified: false },
      ],
    });

    expect(result.card.frontmatter.type).toBe('feature');
    expect(result.card.frontmatter.priority).toBe('high');
    expect(result.card.frontmatter.acceptance).toHaveLength(1);
  });

  it('should persist type and priority in DB', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'db-check',
      summary: 'DB check',
      type: 'bug',
      priority: 'critical',
    });

    const row = tc.ctx.cardRepo.findByKey('db-check');
    expect(row!.type).toBe('bug');
    expect(row!.priority).toBe('critical');
  });

  it('should update type and priority', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-p1', summary: 'Update P1' });
    const result = await updateCard(tc.ctx, 'upd-p1', {
      type: 'refactor',
      priority: 'low',
    });

    expect(result.card.frontmatter.type).toBe('refactor');
    expect(result.card.frontmatter.priority).toBe('low');
  });

  it('should remove type when set to null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'rm-type',
      summary: 'Remove type',
      type: 'feature',
    });
    const result = await updateCard(tc.ctx, 'rm-type', { type: null });
    expect(result.card.frontmatter.type).toBeUndefined();
  });

  it('should list cards sorted by priority', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'low-p', summary: 'Low', priority: 'low' });
    await createCard(tc.ctx, { slug: 'crit-p', summary: 'Critical', priority: 'critical' });
    await createCard(tc.ctx, { slug: 'high-p', summary: 'High', priority: 'high' });

    const result = listCards(tc.ctx, { sortBy: 'priority' });
    expect(result[0]!.key).toBe('crit-p');
    expect(result[1]!.key).toBe('high-p');
    expect(result[2]!.key).toBe('low-p');
  });

  it('should filter by type', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'feat', summary: 'Feature', type: 'feature' });
    await createCard(tc.ctx, { slug: 'bug', summary: 'Bug', type: 'bug' });
    await createCard(tc.ctx, { slug: 'no-type', summary: 'No type' });

    const result = listCards(tc.ctx, { type: 'feature' });
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('feat');
  });
});

describe('listCards with combined filters', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should filter by status + type + sortBy priority simultaneously', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'df-hi', summary: 'Draft feature high', type: 'feature', priority: 'high' });
    await createCard(tc.ctx, { slug: 'df-lo', summary: 'Draft feature low', type: 'feature', priority: 'low' });
    await createCard(tc.ctx, { slug: 'af-cr', summary: 'Accepted feature critical', type: 'feature', priority: 'critical' });
    await updateCardStatus(tc.ctx, 'af-cr', 'accepted');
    await createCard(tc.ctx, { slug: 'db-md', summary: 'Draft bug medium', type: 'bug', priority: 'medium' });

    const result = listCards(tc.ctx, { status: 'draft', type: 'feature', sortBy: 'priority' });
    expect(result).toHaveLength(2);
    expect(result[0]!.key).toBe('df-hi');
    expect(result[1]!.key).toBe('df-lo');
  });
});

describe('updateCard changelog for type and priority', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should record changelog entry when type changes', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'cl-type', summary: 'Type changelog', type: 'feature' });
    await updateCard(tc.ctx, 'cl-type', { type: 'bug' });

    const history = getCardHistory(tc.ctx, 'cl-type');
    const typeChange = history.find((h) => h.field === 'type');
    expect(typeChange).toBeDefined();
    expect(typeChange!.oldValue).toBe('feature');
    expect(typeChange!.newValue).toBe('bug');
  });

  it('should record changelog entry when priority changes', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'cl-prio', summary: 'Priority changelog', priority: 'low' });
    await updateCard(tc.ctx, 'cl-prio', { priority: 'critical' });

    const history = getCardHistory(tc.ctx, 'cl-prio');
    const prioChange = history.find((h) => h.field === 'priority');
    expect(prioChange).toBeDefined();
    expect(prioChange!.oldValue).toBe('low');
    expect(prioChange!.newValue).toBe('critical');
  });

  it('should record changelog entries when both type and priority change simultaneously', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'cl-both', summary: 'Both changelog', type: 'feature', priority: 'low' });
    await updateCard(tc.ctx, 'cl-both', { type: 'refactor', priority: 'high' });

    const history = getCardHistory(tc.ctx, 'cl-both');
    const typeChange = history.find((h) => h.field === 'type');
    const prioChange = history.find((h) => h.field === 'priority');
    expect(typeChange).toBeDefined();
    expect(typeChange!.oldValue).toBe('feature');
    expect(typeChange!.newValue).toBe('refactor');
    expect(prioChange).toBeDefined();
    expect(prioChange!.oldValue).toBe('low');
    expect(prioChange!.newValue).toBe('high');
  });

  it('should record changelog entry when type is set from null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'cl-null-type', summary: 'Null type' });
    await updateCard(tc.ctx, 'cl-null-type', { type: 'bug' });

    const history = getCardHistory(tc.ctx, 'cl-null-type');
    const typeChange = history.find((h) => h.field === 'type');
    expect(typeChange).toBeDefined();
    expect(typeChange!.oldValue).toBeNull();
    expect(typeChange!.newValue).toBe('bug');
  });

  it('should record changelog entry when type is cleared to null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'cl-clear-type', summary: 'Clear type', type: 'feature' });
    await updateCard(tc.ctx, 'cl-clear-type', { type: null });

    const history = getCardHistory(tc.ctx, 'cl-clear-type');
    const typeChange = history.find((h) => h.field === 'type');
    expect(typeChange).toBeDefined();
    expect(typeChange!.oldValue).toBe('feature');
    expect(typeChange!.newValue).toBeNull();
  });

  it('should not record changelog entry when type value is unchanged', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'cl-same-type', summary: 'Same type', type: 'feature' });
    await updateCard(tc.ctx, 'cl-same-type', { type: 'feature' });

    const history = getCardHistory(tc.ctx, 'cl-same-type');
    const typeChanges = history.filter((h) => h.field === 'type');
    expect(typeChanges).toHaveLength(0);
  });
});
