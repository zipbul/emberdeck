/**
 * Default-row factory for `CardRow` shape used by spec tests.
 *
 * Tests that build cards directly (bypassing createCard) use this so the
 * defaults stay in one place — three near-identical copies were drifting.
 */
import type { CardRow } from '../../src/db/repository';

export function makeCardRow(overrides: Partial<CardRow> = {}): CardRow {
  return {
    key: 'test-card',
    summary: 'Test card',
    status: 'draft',
    type: 'spec',
    parent: null,
    boundaryJson: null,
    namespacesJson: null,
    body: null,
    glossaryJson: '[]',
    filePath: '.emberdeck/cards/test-card.md',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
