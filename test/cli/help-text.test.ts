/**
 * Help-text drift guard: option descriptions that enumerate card types must
 * stay welded to CARD_TYPES (hand-typed lists rot — vision was missing).
 */
import { describe, it, expect } from 'bun:test';
import { Command } from 'commander';

import { registerCard } from '../../src/cli/commands/card';
import { CARD_TYPES } from '../../src/card/types';

function typeOptionDescription(sub: string): string {
  const program = new Command();
  registerCard(program);
  const card = program.commands.find((c) => c.name() === 'card')!;
  const cmd = card.commands.find((c) => c.name() === sub)!;
  const opt = cmd.options.find((o) => o.long === '--type')!;
  return opt.description;
}

describe('card --type help text', () => {
  it.each(['create', 'list'])('%s lists every CARD_TYPES value', (sub) => {
    const desc = typeOptionDescription(sub);
    for (const t of CARD_TYPES) {
      expect(desc).toContain(t);
    }
  });
});
