import { describe, test, expect } from 'bun:test';
import { describeCardBody } from './serialize';
import { CARD_TYPES } from './types';

describe('describeCardBody', () => {
  test.each([...CARD_TYPES])('%s: namespace matches type and skeleton is under it', (type) => {
    const s = describeCardBody(type);
    expect(s.type).toBe(type);
    expect(s.namespace).toBe(type);
    expect(Object.keys(s.skeleton)).toEqual([type]);
  });

  test.each([...CARD_TYPES])('%s: skeleton contains exactly the required top-level fields', (type) => {
    const s = describeCardBody(type);
    const required = s.fields.filter((f) => f.required).map((f) => f.name).sort();
    const skeletonKeys = Object.keys(s.skeleton[type] as Record<string, unknown>).sort();
    expect(skeletonKeys).toEqual(required);
  });

  test.each([...CARD_TYPES])('%s: every enum field carries its allowed values or a note', (type) => {
    const s = describeCardBody(type);
    for (const f of s.fields) {
      if (f.kind === 'enum') expect(f.values && f.values.length > 0).toBe(true);
    }
  });

  test('vision exposes exactly its three required string fields', () => {
    const s = describeCardBody('vision');
    expect(s.fields.map((f) => f.name)).toEqual(['statement', 'rationale', 'success_direction']);
    expect(s.fields.every((f) => f.required && f.kind === 'string')).toBe(true);
  });
});
