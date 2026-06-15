/**
 * verify.class=structural engine end-to-end through `validate cards`.
 *
 * A structural principle declares a closed graph predicate; the engine
 * evaluates it over the principle's applies_to scope and gates by enforcement:
 * blocking → exit 2 (principle-violation), warning → non-gating
 * (principle-violation-warning, exit 0).
 *
 * Uses principle cards as the graph fixtures: they are root nodes (no empty-tree
 * check) and may declare relations, so the only finding is the one under test.
 */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEd, setupTmpProject } from './helpers';

function write(tmp: string, slug: string, body: string) {
  writeFileSync(join(tmp, '.emberdeck/cards', `${slug}.md`), body);
}

function guard(enforcement: string): string {
  return `---
key: guard
summary: Area a must not couple to area b.
status: active
type: principle
principle:
  statement: A card in area a MUST NOT declare a relation to area b.
  rationale: Areas a and b are independent bounded contexts.
  applies_to:
    - a-src
  enforcement: ${enforcement}
  verify:
    class: structural
    structural:
      kind: forbids-relation-to
      targetGlob: b-*
---

## Notes
`;
}

function plainPrinciple(key: string, relations?: string[]): string {
  const rel = relations ? `relations:\n${relations.map((r) => `  - ${r}`).join('\n')}\n` : '';
  return `---
key: ${key}
summary: ${key} principle.
status: active
type: principle
${rel}principle:
  statement: ${key} SHOULD hold.
  rationale: because.
  applies_to:
    - ${key}
  enforcement: advisory
  verify:
    class: prose
---

## Notes
`;
}

function seed(tmp: string, enforcement: string) {
  write(tmp, 'guard', guard(enforcement));
  write(tmp, 'a-src', plainPrinciple('a-src', ['b-dst']));
  write(tmp, 'b-dst', plainPrinciple('b-dst'));
}

describe('structural verify engine end-to-end', () => {
  it('blocking structural violation gates validate (exit 2)', async () => {
    const { tmp, cleanup } = setupTmpProject();
    try {
      seed(tmp, 'blocking');
      const r = await runEd(['validate', 'cards'], tmp);
      const data = JSON.parse(r.stdout);
      expect(data.summary.byCode['principle-violation']).toBeGreaterThanOrEqual(1);
      expect(r.exitCode).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('warning structural violation is non-gating (exit 0)', async () => {
    const { tmp, cleanup } = setupTmpProject();
    try {
      seed(tmp, 'warning');
      const r = await runEd(['validate', 'cards'], tmp);
      const data = JSON.parse(r.stdout);
      expect(data.summary.byCode['principle-violation-warning']).toBeGreaterThanOrEqual(1);
      expect(data.summary.byCode['principle-violation']).toBeUndefined();
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });
});
