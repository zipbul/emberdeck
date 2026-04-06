import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createEmberdeckDb, closeDb } from '../db/connection';
import type { EmberdeckDb } from '../db/connection';
import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { DrizzleChangelogRepository } from '../db/changelog-repo';
import {
  parseSections,
  validateBrief,
  REQUIRED_BRIEF_SECTIONS,
} from './validate';

let db: EmberdeckDb;
let ctx: EmberdeckContext;

function makeCard(overrides: Partial<CardRow> = {}): CardRow {
  return {
    key: 'test-card',
    summary: 'Test card',
    status: 'draft',
    type: 'intent',
    parent: null,
    boundaryJson: null,
    body: null,
    glossaryJson: '[]',
    filePath: '.emberdeck/cards/test-card.card.md',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  const cardRepo = new DrizzleCardRepository(db);
  const relationRepo = new DrizzleRelationRepository(db);
  const classificationRepo = new DrizzleClassificationRepository(db);
  const codeLinkRepo = new DrizzleCodeLinkRepository(db);
  const changelogRepo = new DrizzleChangelogRepository(db);

  ctx = {
    cardsDir: '/tmp/test-cards',
    db,
    cardRepo,
    relationRepo,
    classificationRepo,
    codeLinkRepo,
    changelogRepo,
    ignorePatterns: [],
    regressionThreshold: 0,
    gildash: undefined,
  };
});

afterEach(() => {
  closeDb(db);
});

// ── parseSections ───────────────────────────────────────────────────

describe('parseSections', () => {
  it('parses ## headings from markdown body', () => {
    const body = `
## Motivation

This is the motivation section.
It has multiple lines.

## Scope

### Goals
- Goal 1
- Goal 2

### Non-goals
- Not this
`.trim();

    const sections = parseSections(body);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.heading).toBe('Motivation');
    expect(sections[0]!.normalizedName).toBe('motivation');
    expect(sections[0]!.body).toContain('motivation section');
    expect(sections[1]!.heading).toBe('Scope');
    expect(sections[1]!.body).toContain('Goal 1');
  });

  it('handles all 8 required sections', () => {
    const body = REQUIRED_BRIEF_SECTIONS.map(
      (s) => `## ${s.charAt(0).toUpperCase() + s.slice(1)}\n\nContent for ${s}. And more detail here.`,
    ).join('\n\n');

    const sections = parseSections(body);
    expect(sections).toHaveLength(8);
  });

  it('is case-insensitive via normalizedName', () => {
    const body = '## MOTIVATION\n\nSome content here. And another sentence.';
    const sections = parseSections(body);
    expect(sections[0]!.normalizedName).toBe('motivation');
  });

  it('returns empty for body with no ## headings', () => {
    const sections = parseSections('Just plain text\nwith no headings.');
    expect(sections).toHaveLength(0);
  });
});

// ── validateBrief ───────────────────────────────────────────────────

function insertIntentCard(key: string, body: string, parent?: string) {
  ctx.cardRepo.upsert(
    makeCard({
      key,
      summary: `Test intent: ${key}`,
      type: 'intent',
      parent: parent ?? null,
      body,
      filePath: `.emberdeck/cards/${key}.card.md`,
    }),
  );
}

const COMPLETE_BRIEF_BODY = `
## Motivation

Offline store revenue has plateaued at 200M KRW/year for 3 consecutive years.
Online channel needed to reach customers beyond geographic limits.

## Scope

### Goals
- Product search with filtering
- Cart and ordering system

### Non-goals
- Delivery tracking
- Review system

## Scenario

User searches for product by keyword.
Selects product, chooses options, adds to cart.

## Rule

Refund must be processed within 7 days of purchase.
Maximum 2 discounts stacked per order.

## Constraint

전자상거래법 requires 7-day unconditional return for online purchases.
PG settlement is T+2 business days, cannot expedite.

## Risk

PG integration failure during peak hours is possible.
Mitigation: circuit breaker plus fallback to secondary PG.

## Criteria

Conversion rate target is 15% within 6 months of launch.
Cart abandonment rate must be below 40%.

## Decision

Chose Stripe over Toss Payments for international expansion potential.
Chose modular monolith over microservices due to team size of 3 engineers.
`.trim();

describe('validateBrief', () => {
  it('returns complete for a card with all 8 sections', () => {
    insertIntentCard('test-brief', COMPLETE_BRIEF_BODY);
    const result = validateBrief(ctx, 'test-brief');

    expect(result.complete).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.present).toHaveLength(8);
    expect(result.qualityErrors).toBe(0);
  });

  it('detects missing sections', () => {
    const body = `
## Motivation

Revenue has plateaued. Online channel is needed.

## Scope

Search and ordering only. No delivery tracking.
`.trim();
    insertIntentCard('partial-brief', body);
    const result = validateBrief(ctx, 'partial-brief');

    expect(result.complete).toBe(false);
    expect(result.present).toContain('motivation');
    expect(result.present).toContain('scope');
    expect(result.missing).toContain('scenario');
    expect(result.missing).toContain('rule');
    expect(result.missing).toContain('constraint');
    expect(result.missing).toContain('risk');
    expect(result.missing).toContain('criteria');
    expect(result.missing).toContain('decision');
  });

  it('collects sections from descendant intent cards', () => {
    insertIntentCard('root', '## Motivation\n\nWe need this product. Revenue is declining.');
    insertIntentCard('child-scope', '## Scope\n\nSearch and ordering. No delivery tracking.', 'root');
    insertIntentCard('child-scenario', '## Scenario\n\nUser searches products. User places order.', 'root');
    insertIntentCard('child-rules', [
      '## Rule\n\nRefund within 7 days. Max 2 discounts.',
      '## Constraint\n\nGDPR applies. PG settlement T+2.',
      '## Risk\n\nPG failure during peak. Mitigation: circuit breaker.',
      '## Criteria\n\n15% conversion rate. Below 40% abandonment.',
      '## Decision\n\nStripe over Toss. Monolith over microservices.',
    ].join('\n\n'), 'root');

    const result = validateBrief(ctx, 'root');
    expect(result.complete).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('L1: detects empty sections', () => {
    const body = COMPLETE_BRIEF_BODY.replace(
      /## Risk\n\n[\s\S]*?(?=\n## Criteria)/,
      '## Risk\n\n\n## Criteria',
    );
    insertIntentCard('empty-risk', body);
    const result = validateBrief(ctx, 'empty-risk');

    expect(result.complete).toBe(false);
    expect(result.sections['risk']?.status).toBe('error');
    expect(result.sections['risk']?.errors[0]).toContain('empty');
  });

  it('L1: detects TBD placeholder', () => {
    const body = COMPLETE_BRIEF_BODY.replace(
      /## Risk\n\n[\s\S]*?(?=\n## Criteria)/,
      '## Risk\n\nTBD\n\n## Criteria',
    );
    insertIntentCard('tbd-risk', body);
    const result = validateBrief(ctx, 'tbd-risk');

    expect(result.complete).toBe(false);
    expect(result.sections['risk']?.status).toBe('error');
    expect(result.sections['risk']?.errors[0]).toContain('placeholder');
  });

  it('L2: warns on ambiguous terms', () => {
    const body = COMPLETE_BRIEF_BODY.replace(
      'Conversion rate target is 15% within 6 months of launch.',
      'The system should be fast and user-friendly.',
    );
    insertIntentCard('ambiguous', body);
    const result = validateBrief(ctx, 'ambiguous');

    expect(result.qualityWarnings).toBeGreaterThan(0);
    const criteriaWarnings = result.sections['criteria']?.warnings ?? [];
    expect(criteriaWarnings.some((w) => w.includes('fast'))).toBe(true);
  });

  it('throws for non-existent card', () => {
    expect(() => validateBrief(ctx, 'nonexistent')).toThrow('Card not found');
  });

  it('throws for spec card', () => {
    ctx.cardRepo.upsert(
      makeCard({
        key: 'spec-card',
        summary: 'A spec',
        type: 'spec',
        body: '## Motivation\n\nTest content here.',
        filePath: '.emberdeck/cards/spec-card.card.md',
      }),
    );
    expect(() => validateBrief(ctx, 'spec-card')).toThrow('expected "intent"');
  });
});
