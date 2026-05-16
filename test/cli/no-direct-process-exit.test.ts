/**
 * Phase 3.2 contract test: command implementations must never call
 * `process.exit` directly — exit codes are returned to the runner, which
 * owns lifecycle and exits centrally. A direct `process.exit` would short-
 * circuit the runner's cleanup/drain logic.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const COMMANDS_DIR = join(import.meta.dir, '../../src/cli/commands');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('src/cli/commands/*.ts must not call process.exit directly', () => {
  test('no process.exit() in any command file', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walkTs(COMMANDS_DIR)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, idx) => {
        // Match `process.exit(` while ignoring comments & string literals best-effort.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (/\bprocess\s*\.\s*exit\s*\(/.test(line)) {
          offenders.push({ file, line: idx + 1, text: line.trim() });
        }
      });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join('\n');
      throw new Error(`process.exit() found in command files:\n${report}`);
    }
    expect(offenders).toHaveLength(0);
  });
});
