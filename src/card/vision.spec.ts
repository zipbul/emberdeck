/**
 * vision card type — schema round-trip + structural validation.
 *
 * vision is an enforcement-free root node (CARD_MODEL_DESIGN §9.1): it states
 * the project's direction. Fields statement/rationale/success_direction are
 * all required; it carries no applies_to/enforcement and must be root-level.
 */
import { describe, expect, it } from 'bun:test';
import { parseCard, serializeCard } from './serialize';
import { validateVisionCard } from '../vision/validate';
import { CardValidationError } from './errors';

const VISION_CARD = `---
key: project-vision
summary: A system that expresses all project design knowledge as cards.
status: active
type: vision
vision:
  statement: >-
    Cards are the single source of truth for a project; code is derived from
    cards, so an agent understands the whole system from cards alone.
  rationale: >-
    Design knowledge scattered across code and prose drifts; anchoring it in
    cards makes the system's intent inspectable and regenerable.
  success_direction: >-
    A newcomer (human or agent) can explain why the system is shaped the way it
    is using only the cards, without reading source.
---

## Notes

Vision body filler.
`;

describe('vision card serialize round-trip', () => {
  it('parses and re-serializes a vision card idempotently', () => {
    const first = parseCard(VISION_CARD);
    expect(first.frontmatter.type).toBe('vision');
    expect(first.frontmatter.vision?.statement).toContain('single source of truth');
    expect(first.frontmatter.vision?.rationale).toContain('drift');
    expect(first.frontmatter.vision?.success_direction).toContain('without reading source');
    // No principle-only fields leak in.
    expect((first.frontmatter.vision as unknown as Record<string, unknown>).applies_to).toBeUndefined();
    expect((first.frontmatter.vision as unknown as Record<string, unknown>).enforcement).toBeUndefined();

    const second = parseCard(serializeCard(first.frontmatter));
    expect(second.frontmatter.vision).toEqual(first.frontmatter.vision);
  });

  it('rejects a vision namespace missing a required field', () => {
    const bad = VISION_CARD.replace(/  success_direction: >-[\s\S]*?source\.\n/, '');
    expect(() => parseCard(bad)).toThrow();
  });
});

describe('validateVisionCard', () => {
  it('accepts a complete vision body', () => {
    expect(() =>
      validateVisionCard({
        statement: 's',
        rationale: 'r',
        success_direction: 'd',
      }),
    ).not.toThrow();
  });

  it('throws when the namespace is missing', () => {
    expect(() => validateVisionCard(undefined)).toThrow(CardValidationError);
  });

  it('throws when statement is blank', () => {
    expect(() =>
      validateVisionCard({ statement: '  ', rationale: 'r', success_direction: 'd' }),
    ).toThrow(CardValidationError);
  });

  it('throws when success_direction is blank', () => {
    expect(() =>
      validateVisionCard({ statement: 's', rationale: 'r', success_direction: '' }),
    ).toThrow(CardValidationError);
  });
});
