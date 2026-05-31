/**
 * vision card type — end-to-end through the CLI: disk card → auto-sync → DB →
 * validate. Confirms a vision card validates clean and that a second vision
 * card trips the singleton (≤1 per project) rule with a non-zero exit.
 */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEd, setupTmpProject } from './helpers';

function visionCard(key: string): string {
  return `---
key: ${key}
summary: A system that expresses all project design knowledge as cards.
status: active
type: vision
vision:
  statement: Cards are the source of truth; code is derived from cards.
  rationale: Anchoring design knowledge in cards keeps intent inspectable.
  success_direction: A newcomer can explain the system using only the cards.
---

## Notes
`;
}

describe('vision card end-to-end', () => {
  it('validates a single vision card clean', async () => {
    const { tmp, cleanup } = setupTmpProject();
    try {
      writeFileSync(join(tmp, '.emberdeck/cards/project-vision.md'), visionCard('project-vision'));
      const r = await runEd(['validate', 'cards'], tmp);
      expect(r.exitCode).toBe(0);
      const data = JSON.parse(r.stdout);
      expect(data.summary.total).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('rejects a second vision card (singleton ≤1)', async () => {
    const { tmp, cleanup } = setupTmpProject();
    try {
      writeFileSync(join(tmp, '.emberdeck/cards/project-vision.md'), visionCard('project-vision'));
      writeFileSync(join(tmp, '.emberdeck/cards/other-vision.md'), visionCard('other-vision'));
      const r = await runEd(['validate', 'cards'], tmp);
      expect(r.exitCode).not.toBe(0);
      const data = JSON.parse(r.stdout);
      expect(data.summary.byCode['vision-singleton']).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  it('exposes a vision card through card get', async () => {
    const { tmp, cleanup } = setupTmpProject();
    try {
      writeFileSync(join(tmp, '.emberdeck/cards/project-vision.md'), visionCard('project-vision'));
      await runEd(['validate', 'cards'], tmp); // triggers sync
      const r = await runEd(['card', 'get', 'project-vision'], tmp);
      expect(r.exitCode).toBe(0);
      const data = JSON.parse(r.stdout);
      expect(data.vision?.statement).toContain('source of truth');
    } finally {
      cleanup();
    }
  });
});
