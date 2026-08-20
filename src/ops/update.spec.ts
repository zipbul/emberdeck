import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { assertRejects, createTestContext, type TestContext } from '../../test/helpers';
import { CardValidationError } from '../card/errors';
import { createCard } from './create';
import { updateCard } from './update';

let t: TestContext;

beforeEach(async () => {
  t = await createTestContext();
});

afterEach(async () => {
  await t.cleanup();
});

async function makeHealthyPrinciple(): Promise<void> {
  await createCard(t.ctx, {
    key: 'p',
    summary: 'p',
    type: 'principle',
    principle: {
      statement: 'X MUST Y',
      rationale: 'z',
      applies_to: '*',
      enforcement: 'warning',
      verify: { class: 'prose' },
    },
  });
}

async function makeHealthyBrief(): Promise<void> {
  await createCard(t.ctx, { key: 'd', summary: 'd', type: 'domain', domain: { overview: 'o', scope: 'IN: a. OUT: b.' } });
  await createCard(t.ctx, {
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
}

describe('updateCard — patches the reader would reject', () => {
  it('rejects a principle patch that omits verify', async () => {
    await makeHealthyPrinciple();

    await assertRejects(
      updateCard(t.ctx, 'p', {
        principle: {
          statement: 'X2 MUST Y',
          rationale: 'z',
          applies_to: '*',
          enforcement: 'warning',
        } as never,
      }),
      CardValidationError,
    );
  });

  it('keeps the card readable after a rejected principle patch', async () => {
    await makeHealthyPrinciple();
    await updateCard(t.ctx, 'p', {
      principle: { statement: 'X2', rationale: 'z', applies_to: '*', enforcement: 'warning' } as never,
    }).catch(() => undefined);

    const row = t.ctx.cardRepo.findByKey('p');

    expect(row?.namespacesJson).toContain('verify');
  });

  it('rejects a brief patch whose namespaces are empty shells', async () => {
    await makeHealthyBrief();

    await assertRejects(
      updateCard(t.ctx, 'd/b', {
        brief: { context: {}, scope: {}, flow: [], policy: [], criteria: [], rationale: {} } as never,
      }),
      CardValidationError,
    );
  });

  it('rejects a domain patch that blanks required prose', async () => {
    await createCard(t.ctx, { key: 'dd', summary: 'd', type: 'domain', domain: { overview: 'o', scope: 'IN: a. OUT: b.' } });

    await assertRejects(updateCard(t.ctx, 'dd', { domain: { overview: '', scope: '' } }), CardValidationError);
  });

  it('rejects a live active principle being patched into an illegal enforcement pairing', async () => {
    await createCard(t.ctx, {
      key: 'live',
      summary: 'l',
      type: 'principle',
      status: 'active',
      principle: {
        statement: 'X MUST Y',
        rationale: 'z',
        applies_to: '*',
        enforcement: 'blocking',
        verify: { class: 'structural', structural: { kind: 'forbids-relation-to', targetGlob: 'nope/**' } },
      },
    });

    await updateCard(t.ctx, 'live', {
      principle: {
        statement: 'X MUST Y',
        rationale: 'z',
        applies_to: '*',
        enforcement: 'blocking',
        verify: { class: 'prose' },
      },
    }).catch(() => undefined);

    expect(t.ctx.cardRepo.findByKey('live')?.namespacesJson).toContain('structural');
  });
});
