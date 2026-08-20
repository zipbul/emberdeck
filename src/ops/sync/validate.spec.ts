import { readFile, rm, writeFile } from 'node:fs/promises';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { assertRejects, createTestContext, type TestContext } from '../../../test/helpers';
import { createCard } from '../create';
import { updateCardStatus } from '../update';
import { validateCards } from './validate';

let t: TestContext;

beforeEach(async () => {
  t = await createTestContext();
});

afterEach(async () => {
  await t.cleanup();
});

async function makeDomain(key: string): Promise<string> {
  const res = await createCard(t.ctx, {
    key,
    summary: key,
    type: 'domain',
    domain: { overview: 'o', scope: 'IN: a. OUT: b.' },
  });
  return res.filePath;
}

describe('validateCards — unreadable card files', () => {
  it('reports a card file that no longer parses even though its DB row still exists', async () => {
    const filePath = await makeDomain('pay');
    await writeFile(filePath, 'THIS IS NOT A CARD\n', 'utf8');

    const result = await validateCards(t.ctx);

    expect(result.warnings.map((w) => w.type)).toContain('unreadable-card');
  });

  it('names the unreadable file in the reported warning', async () => {
    const filePath = await makeDomain('pay');
    await writeFile(filePath, 'THIS IS NOT A CARD\n', 'utf8');

    const result = await validateCards(t.ctx);

    const found = result.warnings.find((w) => w.type === 'unreadable-card');
    expect(found?.cardKey).toBe('pay');
  });
});

describe('validateCards — cards path is not a directory', () => {
  it('surfaces the I/O failure instead of certifying a false-clean empty deck', async () => {
    await rm(t.cardsDir, { recursive: true, force: true });
    await writeFile(t.cardsDir, 'i am a regular file\n', 'utf8');

    await assertRejects(validateCards(t.ctx), Error);
  });
});

describe('validateCards — missing cards directory', () => {
  it('treats an absent cards directory as an empty deck instead of throwing', async () => {
    await rm(t.cardsDir, { recursive: true, force: true });

    const result = await validateCards(t.ctx);

    expect(result.orphanFiles).toEqual([]);
  });
});

describe('validateCards — empty-tree message', () => {
  it('states the actual status of a drifted childless container', async () => {
    await makeDomain('solo');
    await updateCardStatus(t.ctx, 'solo', 'drifted', 'r');

    const result = await validateCards(t.ctx);

    const found = result.warnings.find((w) => w.type === 'empty-tree');
    expect(found?.message).toContain('drifted');
  });

  it('does not label a drifted childless container as Active', async () => {
    await makeDomain('solo');
    await updateCardStatus(t.ctx, 'solo', 'drifted', 'r');

    const result = await validateCards(t.ctx);

    const found = result.warnings.find((w) => w.type === 'empty-tree');
    expect(found?.message).not.toContain('Active');
  });
});

describe('validateCards — non-draft body integrity (activation-equivalent)', () => {
  it('reports an active brief whose flow covers a goal that does not exist', async () => {
    await makeDomain('d');
    const brief = await createCard(t.ctx, {
      key: 'd/b',
      summary: 'b',
      type: 'brief',
      parent: 'd',
      brief: {
        context: { problem: 'p', impact: [{ statement: 'i' }] },
        scope: {
          goals: [{ id: 'G-001', statement: 'g' }],
          non_goals: [{ id: 'NG-001', statement: 'n' }],
          assumptions: [{ id: 'A-001', statement: 'a' }],
        },
        flow: [
          { id: 'S-H-01', kind: 'happy', given: 'g', when: 'w', then: 't', covers: ['G-001'] },
          { id: 'S-F-01', kind: 'failure', given: 'g', when: 'w', then: 't', covers: ['G-001'] },
        ],
        policy: [{ id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: ['S-H-01', 'S-F-01'] }],
        criteria: [{ id: 'SC-001', type: 'binary', measure: { predicate: 'p' }, verifies: ['S-H-01', 'S-F-01'] }],
        rationale: {
          alternatives: [
            { option: 'a', pros: ['p'], cons: ['c'] },
            { option: 'b', pros: ['p'], cons: ['c'] },
          ],
          chosen: { option: 'a', reasoning: 'r' },
          addresses: [],
        },
      },
    });
    // Hand-edit past the write path: break the coverage web and claim active.
    const text = await readFile(brief.filePath, 'utf8');
    await writeFile(brief.filePath, text.replace('- G-001', '- G-999').replace('status: draft', 'status: active'), 'utf8');

    const result = await validateCards(t.ctx);

    expect(result.warnings.map((w) => w.type)).toContain('active-body-invalid');
  });
});

describe('validateCards — non-mutating', () => {
  it('leaves the indexed row untouched when the file has drifted', async () => {
    const filePath = await makeDomain('d');
    const text = await readFile(filePath, 'utf8');
    await writeFile(filePath, text.replace('summary: d', 'summary: EDITED'), 'utf8');

    await validateCards(t.ctx);

    expect(t.ctx.cardRepo.findByKey('d')?.summary).toBe('d');
  });

  it('reports the drift it refused to heal', async () => {
    const filePath = await makeDomain('d');
    const text = await readFile(filePath, 'utf8');
    await writeFile(filePath, text.replace('summary: d', 'summary: EDITED'), 'utf8');

    const result = await validateCards(t.ctx);

    expect(result.warnings.map((w) => w.type)).toContain('content-mismatch');
  });
});

describe('validateCards — index fidelity beyond namespaces', () => {
  it('reports a file whose parent no longer matches the indexed row', async () => {
    await makeDomain('p');
    const a = await createCard(t.ctx, { key: 'p/a', summary: 'a', type: 'domain', domain: { overview: 'o', scope: 'IN: a. OUT: b.' } });
    const text = await readFile(a.filePath, 'utf8');
    await writeFile(a.filePath, `${text.trimEnd()}\n`.replace('type: domain', 'type: domain\nparent: p'), 'utf8');

    const result = await validateCards(t.ctx);

    expect(result.warnings.map((w) => w.type)).toContain('content-mismatch');
  });

  it('reports a file whose status no longer matches the indexed row', async () => {
    const filePath = await makeDomain('d');
    const text = await readFile(filePath, 'utf8');
    await writeFile(filePath, text.replace('status: draft', 'status: active'), 'utf8');

    const result = await validateCards(t.ctx);

    expect(result.warnings.map((w) => w.type)).toContain('content-mismatch');
  });
});
