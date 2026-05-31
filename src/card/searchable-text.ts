/**
 * Generates searchable text from a card's structured frontmatter namespaces.
 *
 * Used to populate the `body` column for FTS5 indexing when the actual markdown
 * body is empty (cards using `principle:` / `domain:` / `brief:` / `spec:` namespace structure).
 *
 * Concatenates all human-readable text fields so full-text search returns
 * matches against namespace content, not just summary.
 */

import type { CardFrontmatter } from './types';

export function buildSearchableText(fm: CardFrontmatter): string {
  const parts: string[] = [];

  if (fm.vision) {
    parts.push(fm.vision.statement, fm.vision.rationale, fm.vision.success_direction);
  }

  if (fm.principle) {
    parts.push(fm.principle.statement);
    parts.push(fm.principle.rationale);
    if (fm.principle.metric) {
      for (const m of fm.principle.metric) parts.push(m.name, m.unit);
    }
    if (fm.principle.exemptions) {
      for (const e of fm.principle.exemptions) parts.push(e.target, e.reason);
    }
    if (fm.principle.references) {
      for (const r of fm.principle.references) parts.push(r.title, r.url);
    }
  }

  if (fm.domain) {
    parts.push(fm.domain.overview, fm.domain.scope);
    if (fm.domain.cross_domain_dependencies) {
      for (const d of fm.domain.cross_domain_dependencies) {
        parts.push(d.domain, d.relationship);
      }
    }
  }

  if (fm.brief) {
    const b = fm.brief;
    parts.push(b.context.problem);
    for (const i of b.context.impact) parts.push(i.statement);

    for (const g of b.scope.goals) parts.push(g.id, g.statement);
    for (const ng of b.scope.non_goals) parts.push(ng.id, ng.statement);
    for (const a of b.scope.assumptions) {
      parts.push(a.id, a.statement);
      if (a.verification) parts.push(a.verification);
      if (a.reevaluate_when) parts.push(a.reevaluate_when);
    }

    for (const f of b.flow) parts.push(f.id, f.given, f.when, f.then);

    parts.push(b.approach);

    for (const p of b.policy) parts.push(p.id, p.subject, p.predicate);
    for (const e of b.external) parts.push(e.id, e.statement, e.reference.title, e.reference.locator);

    for (const l of b.limits) parts.push(l.id, l.statement);

    for (const c of b.criteria) {
      parts.push(c.id);
      const m = c.measure as Record<string, unknown>;
      if (typeof m.predicate === 'string') parts.push(m.predicate);
      if (typeof m.method === 'string') parts.push(m.method);
      if (typeof m.reference === 'string') parts.push(m.reference);
      if (typeof m.unit === 'string') parts.push(m.unit);
    }

    for (const a of b.rationale.alternatives) parts.push(a.option, ...a.pros, ...a.cons);
    parts.push(b.rationale.chosen.option, b.rationale.chosen.reasoning);
    if (b.rationale.trade_off) parts.push(b.rationale.trade_off);
  }

  if (fm.spec) {
    const s = fm.spec;
    for (const p of s.preconditions) parts.push(p.id, p.condition, p.derives);
    for (const p of s.postconditions) parts.push(p.id, p.guarantee, p.derives);
    for (const i of s.invariants) parts.push(i.id, i.statement, i.always_holds);
    for (const f of s.failures) parts.push(f.violation, f.behavior);
    if (s.state_transitions) {
      for (const t of s.state_transitions) parts.push(t.from, t.trigger, t.to);
    }
  }

  return parts.filter((p) => p && p.length > 0).join(' ');
}
