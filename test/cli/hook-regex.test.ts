// Regression tests for .claude/hooks/check-ed-gate.sh — the PreToolUse Bash
// gate that enforces emberdeck HC-0 (marker required before any ed mutation).
//
// codex 11 finding: the original mutating_re matched only 'ed ' at a word
// boundary, so an absolute-path invocation like /home/.../bin/ed card update
// slipped past the gate. The regex now allows a path-prefix segment before
// 'ed', so absolute paths trigger the marker check too.

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { unlinkSync, existsSync } from 'node:fs';

const HOOK = '/home/revil/projects/zipbul/emberdeck/.claude/hooks/check-ed-gate.sh';
const TEST_SESSION_ID = 'hook-test-' + Math.random().toString(36).slice(2);
const TEST_MARKER = '/tmp/claude-emberdeck-gate-' + TEST_SESSION_ID;

function callHook(cmd: string): { exitCode: number; stdout: string; stderr: string } {
  const input = JSON.stringify({
    session_id: TEST_SESSION_ID,
    tool_input: { command: cmd },
  });
  const r = spawnSync(HOOK, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('check-ed-gate.sh — codex 11 regression (absolute path)', () => {
  // No marker for any of these tests — the gate should DENY mutating commands
  // and PASS-THROUGH (empty object) for read-only or unrelated commands.
  beforeAll(() => {
    if (existsSync(TEST_MARKER)) unlinkSync(TEST_MARKER);
  });
  afterAll(() => {
    if (existsSync(TEST_MARKER)) unlinkSync(TEST_MARKER);
  });

  test('bare ed card update triggers gate (no marker -> deny)', () => {
    const r = callHook('ed card update foo --field summary=x');
    expect(r.stdout).toMatch(/permissionDecision":"deny/);
  });

  test('absolute /home/.../bin/ed card update triggers gate (codex 11)', () => {
    const r = callHook('/home/revil/.bun/bin/ed card update foo --field summary=x');
    expect(r.stdout).toMatch(/permissionDecision":"deny/);
  });

  test('absolute path bulk sync also triggers gate', () => {
    const r = callHook('/usr/local/bin/ed bulk sync');
    expect(r.stdout).toMatch(/permissionDecision":"deny/);
  });

  test('read-only ed card get does NOT trigger gate (passes through)', () => {
    const r = callHook('ed card get foo');
    expect(r.stdout.trim()).toBe('{}');
  });

  test('false-positive guard: sed -i does NOT trigger gate', () => {
    const r = callHook('sed -i s/a/b/ file.txt');
    expect(r.stdout.trim()).toBe('{}');
  });

  test('false-positive guard: word ending in ed (e.g. restored) does NOT trigger', () => {
    const r = callHook('restored card update foo');
    expect(r.stdout.trim()).toBe('{}');
  });
});
