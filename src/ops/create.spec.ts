import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { assertRejects, createTestContext, type TestContext } from '../../test/helpers';
import { CardValidationError } from '../card/errors';
import { createCard } from './create';

let t: TestContext;

beforeEach(async () => {
  t = await createTestContext();
});

afterEach(async () => {
  await t.cleanup();
});

describe('createCard — namespace bodies the reader rejects', () => {
  it('rejects a principle body with no verify class', async () => {
    await assertRejects(
      createCard(t.ctx, {
        key: 'p',
        summary: 'p',
        type: 'principle',
        principle: {
          statement: 'X MUST Y',
          rationale: 'z',
          applies_to: '*',
          enforcement: 'blocking',
        } as never,
      }),
      CardValidationError,
    );
  });

  it('rejects a prose principle declared blocking', async () => {
    await assertRejects(
      createCard(t.ctx, {
        key: 'p',
        summary: 'p',
        type: 'principle',
        principle: {
          statement: 'X MUST Y',
          rationale: 'z',
          applies_to: '*',
          enforcement: 'blocking',
          verify: { class: 'prose' },
        },
      }),
      CardValidationError,
    );
  });

  it('rejects a structural principle with no predicate', async () => {
    await assertRejects(
      createCard(t.ctx, {
        key: 'p',
        summary: 'p',
        type: 'principle',
        principle: {
          statement: 'X MUST Y',
          rationale: 'z',
          applies_to: '*',
          enforcement: 'blocking',
          verify: { class: 'structural' },
        },
      }),
      CardValidationError,
    );
  });

  it('rejects a vision body whose statement is not a string', async () => {
    await assertRejects(
      createCard(t.ctx, {
        key: 'vision',
        summary: 'v',
        type: 'vision',
        vision: { statement: 42, rationale: 'r', success_direction: 'd' } as never,
      }),
      CardValidationError,
    );
  });

  it('rejects a domain body with empty required prose', async () => {
    await assertRejects(
      createCard(t.ctx, {
        key: 'd',
        summary: 'd',
        type: 'domain',
        domain: { overview: '', scope: '' },
      }),
      CardValidationError,
    );
  });

  it('leaves no card file behind when the body is rejected', async () => {
    await createCard(t.ctx, {
      key: 'd',
      summary: 'd',
      type: 'domain',
      domain: { overview: '', scope: '' },
    }).catch(() => undefined);

    expect(t.ctx.cardRepo.findByKey('d')).toBeFalsy();
  });
});

describe('createCard — active create must not leak checker crashes', () => {
  it('reports a malformed brief body as a validation error even with --status active', async () => {
    await createCard(t.ctx, { key: 'd', summary: 'd', type: 'domain', domain: { overview: 'o', scope: 'IN: a. OUT: b.' } });

    const err = await assertRejects(
      createCard(t.ctx, {
        key: 'd/b',
        summary: 'b',
        type: 'brief',
        parent: 'd',
        status: 'active',
        brief: { context: { problem: 'p', impact: [] }, scope: { goals: [], non_goals: [], assumptions: [] }, flow: 'not-an-array', policy: [], criteria: [], rationale: { alternatives: [] } } as never,
      }),
      CardValidationError,
    );

    expect(err.message).not.toContain('is not a function');
  });
});
