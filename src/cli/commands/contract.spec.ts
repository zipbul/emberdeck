/**
 * Static contract test: every per-file error emitter under src/cli/commands/
 * must populate `details.file_path` so the runner's CARD_SYNC_FAILED dedup
 * (runner-and-output INV-003) can suppress duplicate warnings.
 *
 * The check is a regex sweep — it does not execute commands. If a new error
 * code is introduced under src/cli/commands/ with a file-path-derived message
 * but no `details.file_path` field, this test fails fast.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('cli/commands per-file error contract', () => {
  test('every code with a file-path-derived message also carries details.file_path', () => {
    const root = join(import.meta.dir);
    const files = walk(root);
    const violations: Array<{ file: string; codeNear: string }> = [];

    // Known codes that carry a file path in their message and therefore must
    // also carry details.file_path. Listed explicitly so the assertion is
    // unambiguous; new file-scoped codes should be added here on introduction.
    const fileScopedCodes = ['SYNC_FAILED', 'ORPHAN_FILE', 'STALE_DB_ROW', 'KEY_MISMATCH'];

    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const code of fileScopedCodes) {
        // Find each emission of this code and check the surrounding ~200 chars
        // for `details: {` mentioning file_path.
        const re = new RegExp(`code:\\s*['"]${code}['"]`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const window = text.slice(Math.max(0, m.index - 40), Math.min(text.length, m.index + 400));
          if (!/details\s*:\s*\{[^}]*file_path/.test(window)) {
            violations.push({ file: file.replace(root, ''), codeNear: window.slice(0, 200) });
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations.map((v) => `\n  ${v.file}: missing details.file_path near\n    ${v.codeNear.replace(/\n/g, '\n    ')}`).join('\n');
      throw new Error(`runner-and-output INV-003 violations:${msg}`);
    }
    expect(violations).toHaveLength(0);
  });
});
