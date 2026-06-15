import { describe, it, expect } from 'bun:test';
import { assertPatchRootKeys, PATCH_ROOT_KEYS } from './card';
import { CliUsageError } from '../usage-error';

// `ed card update --patch` accepts a whole-namespace replacement keyed by an
// UpdateCardFields name. `vision` is a first-class namespace (type=vision
// cards), so a vision patch must be accepted — otherwise vision card bodies
// are unmaintainable through the documented --patch surface.
describe('assertPatchRootKeys — accepted --patch root keys', () => {
  it('accepts a vision namespace patch', () => {
    expect(() => assertPatchRootKeys({ vision: { statement: 's', rationale: 'r', success_direction: 'd' } })).not.toThrow();
  });

  it('rejects a genuinely unknown root key with CliUsageError', () => {
    expect(() => assertPatchRootKeys({ preconditions: [] })).toThrow(CliUsageError);
  });

  it('allows every UpdateCardFields namespace including vision', () => {
    for (const k of ['vision', 'principle', 'domain', 'brief', 'spec'] as const) {
      expect(PATCH_ROOT_KEYS.has(k)).toBe(true);
    }
  });
});
