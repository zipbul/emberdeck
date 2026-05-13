import { describe, expect, test } from 'bun:test';
import { classifyErrorStatus, mergeCardSyncWarnings } from './runner';
import type { CliResult } from './output';

function makeResult(overrides: Partial<CliResult> = {}): CliResult {
  return {
    schemaVersion: { major: 1, minor: 0 },
    status: 'ok',
    data: null,
    warnings: [],
    errors: [],
    ...overrides,
  };
}

describe('runner: classifyErrorStatus', () => {
  test('GILDASH_TRANSIENT → unknown (exit 7)', () => {
    expect(classifyErrorStatus('GILDASH_TRANSIENT')).toBe('unknown');
  });

  test('NETWORK_TRANSIENT → unknown', () => {
    expect(classifyErrorStatus('NETWORK_TRANSIENT')).toBe('unknown');
  });

  test('CARD_NOT_FOUND → error (exit 3 mapped elsewhere)', () => {
    expect(classifyErrorStatus('CARD_NOT_FOUND')).toBe('error');
  });

  test('VALIDATION_ERROR → error', () => {
    expect(classifyErrorStatus('VALIDATION_ERROR')).toBe('error');
  });

  test('unknown code → error (default)', () => {
    expect(classifyErrorStatus('SOMETHING_NEW')).toBe('error');
  });
});

describe('runner: mergeCardSyncWarnings (CARD_SYNC_FAILED dedup)', () => {
  test('returns input unchanged when no sync failures', () => {
    const r = makeResult({ warnings: [{ code: 'X', message: 'x' }] });
    expect(mergeCardSyncWarnings(r, [])).toBe(r);
  });

  test('prepends CARD_SYNC_FAILED when no matching error.details.file_path', () => {
    const r = makeResult();
    const merged = mergeCardSyncWarnings(r, [{ filePath: 'a.md', error: 'parse' }]);
    expect(merged.warnings).toHaveLength(1);
    expect(merged.warnings[0]?.code).toBe('CARD_SYNC_FAILED');
    expect(merged.warnings[0]?.message).toContain('a.md');
  });

  test('suppresses CARD_SYNC_FAILED when same file_path already in errors[]', () => {
    const r = makeResult({
      errors: [{ code: 'SYNC_FAILED', message: 'failed', details: { file_path: 'a.md' } }],
    });
    const merged = mergeCardSyncWarnings(r, [{ filePath: 'a.md', error: 'parse' }]);
    expect(merged.warnings).toHaveLength(0);
  });

  test('suppresses only matched paths, surfaces the rest', () => {
    const r = makeResult({
      errors: [{ code: 'SYNC_FAILED', message: 'failed', details: { file_path: 'a.md' } }],
    });
    const merged = mergeCardSyncWarnings(r, [
      { filePath: 'a.md', error: 'parse' },
      { filePath: 'b.md', error: 'parse' },
    ]);
    expect(merged.warnings).toHaveLength(1);
    expect(merged.warnings[0]?.message).toContain('b.md');
  });

  test('preserves command-emitted warnings after the prepended ones', () => {
    const r = makeResult({ warnings: [{ code: 'X', message: 'x' }] });
    const merged = mergeCardSyncWarnings(r, [{ filePath: 'a.md', error: 'parse' }]);
    expect(merged.warnings).toHaveLength(2);
    expect(merged.warnings[0]?.code).toBe('CARD_SYNC_FAILED');
    expect(merged.warnings[1]?.code).toBe('X');
  });

  test('ignores errors whose details.file_path is not a string', () => {
    const r = makeResult({
      errors: [
        { code: 'WHATEVER', message: 'w', details: { file_path: 42 as unknown as string } },
        { code: 'WHATEVER2', message: 'w2' },
      ],
    });
    const merged = mergeCardSyncWarnings(r, [{ filePath: 'a.md', error: 'parse' }]);
    expect(merged.warnings).toHaveLength(1); // not suppressed
  });

  test('does not mutate the input result', () => {
    const r = makeResult();
    const original = r.warnings;
    mergeCardSyncWarnings(r, [{ filePath: 'a.md', error: 'parse' }]);
    expect(r.warnings).toBe(original);
    expect(r.warnings).toHaveLength(0);
  });

  test('preserves non-ok status when surfacing or suppressing (runner-and-output POST-004)', () => {
    // partial + surfaced
    const r1 = makeResult({
      status: 'partial',
      errors: [{ code: 'REGRESSION_DRIFT', message: 'd', key: 'k1' }],
    });
    const merged1 = mergeCardSyncWarnings(r1, [{ filePath: 'a.md', error: 'parse' }]);
    expect(merged1.status).toBe('partial');
    expect(merged1.warnings).toHaveLength(1);

    // partial + suppressed
    const r2 = makeResult({
      status: 'partial',
      errors: [{ code: 'SYNC_FAILED', message: 'f', details: { file_path: 'a.md' } }],
    });
    const merged2 = mergeCardSyncWarnings(r2, [{ filePath: 'a.md', error: 'parse' }]);
    expect(merged2.status).toBe('partial');
    expect(merged2.warnings).toHaveLength(0);

    // error status preserved on the no-failures fast-path
    const r3 = makeResult({ status: 'error', errors: [{ code: 'X', message: 'x' }] });
    const merged3 = mergeCardSyncWarnings(r3, []);
    expect(merged3.status).toBe('error');
    expect(merged3).toBe(r3);
  });
});
