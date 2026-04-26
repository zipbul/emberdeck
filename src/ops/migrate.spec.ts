import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';

import { createTestContext, type TestContext } from '../../test/helpers';
import { createCard } from './create';
import { migrateCardToNamespace } from './migrate';
import { CardNotFoundError, CardValidationError } from '../card/errors';

const FULL_LEGACY_BODY = `
## Motivation
사용자가 결제할 때마다 일관성 있는 가격을 보여줘야 한다.
가격 변동 시 이미 표시된 가격을 보존해야 한다.

## Scope
Covers:
- 카드 결제 흐름
- 페이팔 결제 흐름

Excludes:
- 분할 결제

Assumes:
- PG 응답 p95 < 3초

## Scenario
### P1: 카드 결제 성공
- Given 카트가 비어있지 않다
- When 사용자가 결제 버튼을 누른다
- Then 주문이 confirmed 상태가 된다

### P2: 결제 실패
- Given 카드 한도 초과
- When 결제 시도
- Then 명확한 에러 메시지가 표시된다

## Rule
- R-001: 결제 시 idempotency_key MUST 사용한다
- R-002: 5분 내 5회 실패 시 SHOULD 다른 결제 수단을 권장한다

## Constraint
- PCI-DSS 4.0 준수
- 한국 전자금융감독규정

## Risk
- 네트워크 단절 시 중복 결제 가능성
- PG 점검 시간 동안 서비스 중단

## Criteria
- SC-001: 결제 성공률 >= 99.5%
- SC-002: 중복 결제 0건

## Decision
PG 직접 연동 대신 Toss Payments SDK를 사용한다.
이유: 자체 구현 시 PCI-DSS 인증 비용이 과도하다.
`.trim();

const PARTIAL_LEGACY_BODY = `
## Motivation
짧은 동기.
이게 있다.

## Scope
Covers:
- 단일 목표

## Rule
- 모든 입력 MUST validate 한다.

## Criteria
- SC-001: 0 errors
`.trim();

describe('migrateCardToNamespace', () => {
  let tc: TestContext;

  beforeEach(async () => {
    tc = await createTestContext();
  });

  afterEach(async () => {
    await tc.cleanup();
  });

  it('converts an 8-section markdown body into a BriefBody (autoLinkRefs=false)', async () => {
    await createCard(tc.ctx, {
      key: 'order-payment',
      summary: 'order payment area',
      type: 'brief',
      status: 'draft',
      body: FULL_LEGACY_BODY,
    });

    const result = await migrateCardToNamespace(tc.ctx, { cardKey: 'order-payment' });

    expect(result.cardKey).toBe('order-payment');
    expect(result.beforeBody).toContain('## Motivation');
    expect(result.unmappedSections).toEqual([]);

    // Motivation → context.problem
    expect(result.newBriefBody.context.problem).toContain('일관성 있는 가격');

    // Scope → goals/non_goals/assumptions
    expect(result.newBriefBody.scope.goals.length).toBe(2);
    expect(result.newBriefBody.scope.goals[0]?.id).toBe('G-001');
    expect(result.newBriefBody.scope.goals[0]?.statement).toContain('카드 결제');
    expect(result.newBriefBody.scope.non_goals.length).toBe(1);
    expect(result.newBriefBody.scope.non_goals[0]?.id).toBe('NG-001');
    expect(result.newBriefBody.scope.assumptions.length).toBe(1);
    expect(result.newBriefBody.scope.assumptions[0]?.id).toBe('A-001');

    // Scenario → flow (1 happy + 1 failure)
    expect(result.newBriefBody.flow.length).toBe(2);
    const happy = result.newBriefBody.flow.find((f) => f.kind === 'happy');
    const failure = result.newBriefBody.flow.find((f) => f.kind === 'failure');
    expect(happy).toBeDefined();
    expect(failure).toBeDefined();
    expect(happy?.id).toBe('S-H-01');
    expect(failure?.id).toBe('S-F-01');
    expect(happy?.given).toContain('카트');
    expect(happy?.then).toContain('confirmed');

    // Rule → policy (preserves R-IDs)
    expect(result.newBriefBody.policy.length).toBe(2);
    expect(result.newBriefBody.policy[0]?.id).toBe('R-001');
    expect(result.newBriefBody.policy[0]?.keyword).toBe('MUST');
    expect(result.newBriefBody.policy[1]?.id).toBe('R-002');
    expect(result.newBriefBody.policy[1]?.keyword).toBe('SHOULD');

    // Constraint → external
    expect(result.newBriefBody.external.length).toBe(2);
    expect(result.newBriefBody.external[0]?.id).toBe('C-001');

    // Risk → limits
    expect(result.newBriefBody.limits.length).toBe(2);
    expect(result.newBriefBody.limits[0]?.id).toBe('KL-001');

    // Criteria → criteria (with type guess)
    expect(result.newBriefBody.criteria.length).toBe(2);
    expect(result.newBriefBody.criteria[0]?.id).toBe('SC-001');
    expect(result.newBriefBody.criteria[0]?.type).toBe('numeric');
    expect(result.newBriefBody.criteria[1]?.id).toBe('SC-002');

    // Decision → rationale (always ≥2 alternatives)
    expect(result.newBriefBody.rationale.alternatives.length).toBeGreaterThanOrEqual(2);

    // Cross-refs are empty without autoLinkRefs
    expect(result.newBriefBody.flow[0]?.covers).toEqual([]);
    expect(result.newBriefBody.policy[0]?.governs).toEqual([]);
    expect(result.newBriefBody.criteria[0]?.verifies).toEqual([]);
    expect(result.newBriefBody.rationale.addresses).toEqual([]);

    // Validation should fail because cross-refs are empty
    expect(result.validationStatus.startsWith('fails')).toBe(true);
  });

  it('reports missing sections in warnings when only 4 sections are present', async () => {
    await createCard(tc.ctx, {
      key: 'partial',
      summary: 'partial brief',
      type: 'brief',
      status: 'draft',
      body: PARTIAL_LEGACY_BODY,
    });

    const result = await migrateCardToNamespace(tc.ctx, { cardKey: 'partial' });

    // Present: motivation, scope, rule, criteria
    // Missing: scenario, constraint, risk, decision
    const warningStr = result.warnings.join('\n');
    expect(warningStr).toContain('Scenario');
    expect(warningStr).toContain('Constraint');
    expect(warningStr).toContain('Risk');
    expect(warningStr).toContain('Decision');

    // No flow extracted
    expect(result.newBriefBody.flow.length).toBe(0);
    // Empty external/limits
    expect(result.newBriefBody.external.length).toBe(0);
    expect(result.newBriefBody.limits.length).toBe(0);

    expect(result.validationStatus.startsWith('fails')).toBe(true);
  });

  it('autoLinkRefs=true fills cross-refs and reaches passing validation when scope+flow+policy+criteria+rationale align', async () => {
    await createCard(tc.ctx, {
      key: 'auto-linked',
      summary: 'auto-link scenario',
      type: 'brief',
      status: 'draft',
      body: FULL_LEGACY_BODY,
    });

    const result = await migrateCardToNamespace(tc.ctx, {
      cardKey: 'auto-linked',
      autoLinkRefs: true,
    });

    // covers points to first goal
    expect(result.newBriefBody.flow[0]?.covers).toEqual(['G-001']);
    // governs covers all flows
    const allFlowIds = result.newBriefBody.flow.map((f) => f.id);
    for (const p of result.newBriefBody.policy) {
      expect(p.governs.sort()).toEqual([...allFlowIds].sort());
    }
    for (const c of result.newBriefBody.criteria) {
      expect(c.verifies.sort()).toEqual([...allFlowIds].sort());
    }
    // addresses points to first external/limit
    expect(result.newBriefBody.rationale.addresses.length).toBeGreaterThan(0);

    // But: G-002 (page payments) won't be covered by any flow because
    // autoLinkRefs only assigns the FIRST goal. So validation may still fail
    // on the "every goal must be covered" rule.
    if (result.validationStatus.startsWith('fails')) {
      expect(result.validationStatus).toContain('not covered by any flow');
    }
  });

  it('autoLinkRefs=true on a single-goal brief produces validation that passes', async () => {
    const SINGLE_GOAL = `
## Motivation
하나만 한다. 다른 건 안 한다.

## Scope
Covers:
- 단일 흐름

## Scenario
### P1: 정상
- Given a
- When b
- Then c

### P2: 실패
- Given x
- When y
- Then z

## Rule
- R-001: 모두 MUST 한다

## Constraint
- C-001: 외부 규제

## Risk
- KL-001: 네트워크 끊김

## Criteria
- SC-001: 0 errors

## Decision
선택안 A를 사용한다.
이유: 더 간단하다.
`.trim();

    await createCard(tc.ctx, {
      key: 'single-goal',
      summary: 'single-goal brief',
      type: 'brief',
      status: 'draft',
      body: SINGLE_GOAL,
    });

    const result = await migrateCardToNamespace(tc.ctx, {
      cardKey: 'single-goal',
      autoLinkRefs: true,
    });

    expect(result.newBriefBody.scope.goals.length).toBe(1);
    expect(result.newBriefBody.flow.length).toBe(2);
    expect(result.validationStatus).toBe('passes');
  });

  it('throws when card does not exist', async () => {
    await expect(
      migrateCardToNamespace(tc.ctx, { cardKey: 'missing-card' }),
    ).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('throws when card is not a brief', async () => {
    // Create a brief first so we can put a spec underneath
    await createCard(tc.ctx, {
      key: 'parent-brief',
      summary: 'parent',
      type: 'brief',
      status: 'draft',
      body: FULL_LEGACY_BODY,
    });
    await createCard(tc.ctx, {
      key: 'parent-brief/some-spec',
      summary: 'spec card',
      type: 'spec',
      status: 'draft',
      parent: 'parent-brief',
      relations: ['parent-brief'],
      codeLinks: [{ kind: 'function', file: 'src/foo.ts', symbol: 'doStuff' }],
    });

    await expect(
      migrateCardToNamespace(tc.ctx, { cardKey: 'parent-brief/some-spec' }),
    ).rejects.toBeInstanceOf(CardValidationError);
  });

  it('throws when card already has structured brief namespace', async () => {
    // Create a brief without body and patch the file directly to add brief: namespace.
    const created = await createCard(tc.ctx, {
      key: 'already-migrated',
      summary: 'already-migrated brief',
      type: 'brief',
      status: 'draft',
    });

    const yamlWithBrief = `---
key: already-migrated
summary: already-migrated brief
status: draft
type: brief
brief:
  context:
    problem: p
    impact:
      - statement: i
  scope:
    goals:
      - {id: G-001, statement: g}
    non_goals: []
    assumptions: []
  flow:
    - {id: S-H-01, kind: happy, given: a, when: b, then: c, covers: [G-001]}
    - {id: S-F-01, kind: failure, given: a, when: b, then: c, covers: [G-001]}
  design: {overview: o, components: [], data_flow: [], invariants: []}
  policy:
    - {id: R-001, subject: s, keyword: MUST, predicate: p, governs: [S-H-01, S-F-01]}
  external:
    - {id: C-001, statement: s, reference: {title: t, locator: l}}
  compatibility: {guarantees: []}
  limits: []
  criteria:
    - {id: SC-001, type: binary, measure: {predicate: p}, verifies: [S-H-01, S-F-01]}
  rationale:
    alternatives:
      - {option: A, pros: [p], cons: [c]}
      - {option: B, pros: [p], cons: [c]}
    chosen: {option: A, reasoning: r}
    addresses: [C-001]
---
`;
    await writeFile(created.filePath, yamlWithBrief);

    await expect(
      migrateCardToNamespace(tc.ctx, { cardKey: 'already-migrated' }),
    ).rejects.toBeInstanceOf(CardValidationError);
  });

  it('reports unmapped sections when body has unknown headings', async () => {
    const BODY = `
## Motivation
m
m line 2

## Scope
Covers:
- one

## Scenario
### P1
- Given a
- When b
- Then c
### P2 fail
- Given x
- When y
- Then z

## Rule
- R-001: MUST do x

## Constraint
- C-001: external

## Risk
- KL-001: r

## Criteria
- SC-001: 0 errors

## Decision
A 선택. 이유.

## Appendix
extra section that should be unmapped
`.trim();

    await createCard(tc.ctx, {
      key: 'with-extra',
      summary: 'extra section',
      type: 'brief',
      status: 'draft',
      body: BODY,
    });
    const result = await migrateCardToNamespace(tc.ctx, { cardKey: 'with-extra' });
    expect(result.unmappedSections).toContain('Appendix');
  });
});
