import { describe, it, expect } from 'bun:test';

import { CardValidationError } from '../card/errors';
import type { VisionBody } from '../card/types';
import { validateVisionCard } from './validate';

function body(overrides: Partial<VisionBody> = {}): VisionBody {
  return {
    statement: 'from A to B',
    rationale: 'because Z',
    success_direction: 'the observable signal',
    ...overrides,
  };
}

describe('validateVisionCard — non-string field values', () => {
  it('rejects a numeric statement as a validation error', () => {
    expect(() => validateVisionCard(body({ statement: 42 as never }))).toThrow(CardValidationError);
  });

  it('names the offending field instead of leaking the checker crash', () => {
    let message = '';
    try {
      validateVisionCard(body({ statement: 42 as never }));
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('vision.statement');
  });

  it('does not leak "is not a function" from the guard message', () => {
    let message = '';
    try {
      validateVisionCard(body({ rationale: [] as never }));
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).not.toContain('is not a function');
  });
});
