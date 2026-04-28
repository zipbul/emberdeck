import type {
  BriefAssumption,
  BriefBody,
  BriefCompatibility,
  BriefContext,
  BriefCriterion,
  BriefDesign,
  BriefDesignComponent,
  BriefDesignDataFlow,
  BriefDesignInvariant,
  BriefExternal,
  BriefFlow,
  BriefGoal,
  BriefImpact,
  BriefLimit,
  BriefNonGoal,
  BriefPolicy,
  BriefRationale,
  BriefScope,
  CardFile,
  CardFrontmatter,
  CardStatus,
  CardType,
  CodeLink,
  DomainBody,
  PrincipleBody,
  PrincipleMetric,
  SpecBindRef,
  SpecBody,
  SpecFailure,
  SpecInvariant,
  SpecPostcondition,
  SpecPrecondition,
  SpecStateTransition,
} from './types';
import { CARD_TYPES } from './types';
import { CardValidationError } from './errors';

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function isCardStatus(value: unknown): value is CardStatus {
  return value === 'draft' || value === 'active' || value === 'drifted' || value === 'retired';
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CardValidationError(`Invalid frontmatter field: ${field}`);
  }
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new CardValidationError(`Invalid field: ${field} (must be array)`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new CardValidationError(`Invalid field: ${field}[] (each item must be non-empty string)`);
    }
    out.push(item);
  }
  return out;
}

function asObj(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CardValidationError(`Invalid field: ${field} (must be object)`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new CardValidationError(`Invalid field: ${field} (must be array)`);
  }
  return value;
}

// ── Common normalizers ─────────────────────────────────────────

function normalizeTags(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  return asStringArray(value, 'tags').map((s) => s.toLowerCase());
}

function normalizeCodeLinks(value: unknown): CodeLink[] | undefined {
  if (value == null) return undefined;
  const arr = asArray(value, 'codeLinks');
  return arr.map((item) => {
    const cl = asObj(item, 'codeLinks[]');
    return {
      kind: asString(cl.kind, 'codeLinks[].kind'),
      file: asString(cl.file, 'codeLinks[].file'),
      symbol: asString(cl.symbol, 'codeLinks[].symbol'),
    };
  });
}

function normalizeCardType(value: unknown): CardType {
  if (typeof value !== 'string' || !CARD_TYPES.includes(value as CardType)) {
    throw new CardValidationError(`Invalid frontmatter field: type (expected one of: ${CARD_TYPES.join(', ')})`);
  }
  return value as CardType;
}

function normalizeRelations(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  return asStringArray(value, 'relations');
}

function normalizeGlossary(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  return asStringArray(value, 'glossary');
}

function normalizeBoundary(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  return asStringArray(value, 'boundary');
}

// ── Principle body normalizers ─────────────────────────────────

const VALID_ENFORCEMENT = ['blocking', 'warning', 'advisory'];
const VALID_COMPARATORS = ['<', '<=', '=', '>=', '>'];
const VALID_METRIC_KINDS = ['threshold', 'budget'];
const VALID_WINDOW_KINDS = ['static', 'per_cycle', 'rolling', 'calendar'];

function normalizeAppliesTo(value: unknown): '*' | string[] {
  if (value === '*') return '*';
  if (!Array.isArray(value)) {
    throw new CardValidationError('Invalid principle.applies_to (must be "*" or string array)');
  }
  return asStringArray(value, 'principle.applies_to');
}

function normalizeMetric(value: unknown): PrincipleMetric[] | undefined {
  if (value == null) return undefined;
  const arr = asArray(value, 'principle.metric');
  return arr.map((item) => {
    const m = asObj(item, 'principle.metric[]');
    if (typeof m.threshold !== 'number') {
      throw new CardValidationError('Invalid principle.metric[].threshold (must be number)');
    }
    if (typeof m.comparator !== 'string' || !VALID_COMPARATORS.includes(m.comparator)) {
      throw new CardValidationError(`Invalid principle.metric[].comparator (expected one of: ${VALID_COMPARATORS.join(', ')})`);
    }
    const entry: PrincipleMetric = {
      name: asString(m.name, 'principle.metric[].name'),
      threshold: m.threshold,
      unit: asString(m.unit, 'principle.metric[].unit'),
      comparator: m.comparator as PrincipleMetric['comparator'],
    };
    if (m.kind != null) {
      if (typeof m.kind !== 'string' || !VALID_METRIC_KINDS.includes(m.kind)) {
        throw new CardValidationError(`Invalid principle.metric[].kind (expected one of: ${VALID_METRIC_KINDS.join(', ')})`);
      }
      entry.kind = m.kind as PrincipleMetric['kind'];
    }
    if (m.window_kind != null) {
      if (typeof m.window_kind !== 'string' || !VALID_WINDOW_KINDS.includes(m.window_kind)) {
        throw new CardValidationError(`Invalid principle.metric[].window_kind (expected one of: ${VALID_WINDOW_KINDS.join(', ')})`);
      }
      entry.window_kind = m.window_kind as PrincipleMetric['window_kind'];
    }
    if (m.distributable != null) {
      if (typeof m.distributable !== 'boolean') {
        throw new CardValidationError('Invalid principle.metric[].distributable (must be boolean)');
      }
      entry.distributable = m.distributable;
    }
    return entry;
  });
}

function normalizePrincipleBody(value: unknown): PrincipleBody {
  const o = asObj(value, 'principle');
  if (typeof o.enforcement !== 'string' || !VALID_ENFORCEMENT.includes(o.enforcement)) {
    throw new CardValidationError(`Invalid principle.enforcement (expected one of: ${VALID_ENFORCEMENT.join(', ')})`);
  }
  const body: PrincipleBody = {
    statement: asString(o.statement, 'principle.statement'),
    rationale: asString(o.rationale, 'principle.rationale'),
    applies_to: normalizeAppliesTo(o.applies_to),
    enforcement: o.enforcement as PrincipleBody['enforcement'],
  };
  const metric = normalizeMetric(o.metric);
  if (metric !== undefined) body.metric = metric;
  if (o.exemptions != null) {
    body.exemptions = asArray(o.exemptions, 'principle.exemptions').map((item) => {
      const e = asObj(item, 'principle.exemptions[]');
      return {
        target: asString(e.target, 'principle.exemptions[].target'),
        reason: asString(e.reason, 'principle.exemptions[].reason'),
      };
    });
  }
  if (o.references != null) {
    body.references = asArray(o.references, 'principle.references').map((item) => {
      const r = asObj(item, 'principle.references[]');
      return {
        title: asString(r.title, 'principle.references[].title'),
        url: asString(r.url, 'principle.references[].url'),
      };
    });
  }
  return body;
}

// ── Brief body normalizers ─────────────────────────────────────

const ID_PATTERNS = {
  goal: /^G-\d{3,}$/,
  non_goal: /^NG-\d{3,}$/,
  assumption: /^A-\d{3,}$/,
  flow: /^S-(H|F)-\d{2,}$/,
  design_invariant: /^DI-\d{3,}$/,
  policy: /^R-\d{3,}$/,
  external: /^C-\d{3,}$/,
  limit: /^KL-\d{3,}$/,
  criterion: /^SC-\d{3,}$/,
};

function asId(value: unknown, field: string, pattern: RegExp): string {
  const s = asString(value, field);
  if (!pattern.test(s)) {
    throw new CardValidationError(`Invalid ${field}: "${s}" does not match pattern ${pattern}`);
  }
  return s;
}

function normalizeBriefContext(value: unknown): BriefContext {
  const o = asObj(value, 'brief.context');
  const impact = asArray(o.impact, 'brief.context.impact').map((item): BriefImpact => {
    const i = asObj(item, 'brief.context.impact[]');
    const out: BriefImpact = { statement: asString(i.statement, 'brief.context.impact[].statement') };
    if (i.metric != null) {
      const m = asObj(i.metric, 'brief.context.impact[].metric');
      if (typeof m.value !== 'number') {
        throw new CardValidationError('Invalid brief.context.impact[].metric.value (must be number)');
      }
      out.metric = { value: m.value, unit: asString(m.unit, 'brief.context.impact[].metric.unit') };
    }
    return out;
  });
  return { problem: asString(o.problem, 'brief.context.problem'), impact };
}

function normalizeBriefScope(value: unknown): BriefScope {
  const o = asObj(value, 'brief.scope');
  const goals = asArray(o.goals, 'brief.scope.goals').map((item): BriefGoal => {
    const g = asObj(item, 'brief.scope.goals[]');
    return {
      id: asId(g.id, 'brief.scope.goals[].id', ID_PATTERNS.goal),
      statement: asString(g.statement, 'brief.scope.goals[].statement'),
    };
  });
  const non_goals = asArray(o.non_goals, 'brief.scope.non_goals').map((item): BriefNonGoal => {
    const g = asObj(item, 'brief.scope.non_goals[]');
    return {
      id: asId(g.id, 'brief.scope.non_goals[].id', ID_PATTERNS.non_goal),
      statement: asString(g.statement, 'brief.scope.non_goals[].statement'),
    };
  });
  const assumptions = asArray(o.assumptions, 'brief.scope.assumptions').map((item): BriefAssumption => {
    const a = asObj(item, 'brief.scope.assumptions[]');
    const out: BriefAssumption = {
      id: asId(a.id, 'brief.scope.assumptions[].id', ID_PATTERNS.assumption),
      statement: asString(a.statement, 'brief.scope.assumptions[].statement'),
    };
    if (a.verification != null) out.verification = asString(a.verification, 'brief.scope.assumptions[].verification');
    if (a.reevaluate_when != null) out.reevaluate_when = asString(a.reevaluate_when, 'brief.scope.assumptions[].reevaluate_when');
    return out;
  });
  return { goals, non_goals, assumptions };
}

function normalizeBriefFlow(value: unknown): BriefFlow[] {
  const arr = asArray(value, 'brief.flow');
  return arr.map((item): BriefFlow => {
    const f = asObj(item, 'brief.flow[]');
    if (f.kind !== 'happy' && f.kind !== 'failure') {
      throw new CardValidationError('Invalid brief.flow[].kind (must be "happy" or "failure")');
    }
    return {
      id: asId(f.id, 'brief.flow[].id', ID_PATTERNS.flow),
      kind: f.kind,
      given: asString(f.given, 'brief.flow[].given'),
      when: asString(f.when, 'brief.flow[].when'),
      then: asString(f.then, 'brief.flow[].then'),
      covers: asStringArray(f.covers, 'brief.flow[].covers'),
    };
  });
}

function normalizeBriefDesign(value: unknown): BriefDesign {
  const o = asObj(value, 'brief.design');
  const components = asArray(o.components, 'brief.design.components').map((item): BriefDesignComponent => {
    const c = asObj(item, 'brief.design.components[]');
    return {
      name: asString(c.name, 'brief.design.components[].name'),
      responsibility: asString(c.responsibility, 'brief.design.components[].responsibility'),
      interacts_with: asStringArray(c.interacts_with, 'brief.design.components[].interacts_with'),
    };
  });
  const data_flow = asArray(o.data_flow, 'brief.design.data_flow').map((item): BriefDesignDataFlow => {
    const d = asObj(item, 'brief.design.data_flow[]');
    return {
      from: asString(d.from, 'brief.design.data_flow[].from'),
      to: asString(d.to, 'brief.design.data_flow[].to'),
      payload: asString(d.payload, 'brief.design.data_flow[].payload'),
      trigger: asString(d.trigger, 'brief.design.data_flow[].trigger'),
    };
  });
  const invariants = asArray(o.invariants, 'brief.design.invariants').map((item): BriefDesignInvariant => {
    const i = asObj(item, 'brief.design.invariants[]');
    return {
      id: asId(i.id, 'brief.design.invariants[].id', ID_PATTERNS.design_invariant),
      statement: asString(i.statement, 'brief.design.invariants[].statement'),
    };
  });
  return { overview: asString(o.overview, 'brief.design.overview'), components, data_flow, invariants };
}

const VALID_KEYWORDS = ['MUST', 'MUST NOT', 'SHALL', 'SHALL NOT', 'SHOULD', 'SHOULD NOT', 'MAY'];

function normalizeBriefPolicy(value: unknown): BriefPolicy[] {
  const arr = asArray(value, 'brief.policy');
  return arr.map((item): BriefPolicy => {
    const p = asObj(item, 'brief.policy[]');
    if (typeof p.keyword !== 'string' || !VALID_KEYWORDS.includes(p.keyword)) {
      throw new CardValidationError(`Invalid brief.policy[].keyword (expected one of: ${VALID_KEYWORDS.join(', ')})`);
    }
    return {
      id: asId(p.id, 'brief.policy[].id', ID_PATTERNS.policy),
      subject: asString(p.subject, 'brief.policy[].subject'),
      keyword: p.keyword as BriefPolicy['keyword'],
      predicate: asString(p.predicate, 'brief.policy[].predicate'),
      governs: asStringArray(p.governs, 'brief.policy[].governs'),
    };
  });
}

function normalizeBriefExternal(value: unknown): BriefExternal[] {
  const arr = asArray(value, 'brief.external');
  return arr.map((item): BriefExternal => {
    const e = asObj(item, 'brief.external[]');
    const ref = asObj(e.reference, 'brief.external[].reference');
    return {
      id: asId(e.id, 'brief.external[].id', ID_PATTERNS.external),
      statement: asString(e.statement, 'brief.external[].statement'),
      reference: {
        title: asString(ref.title, 'brief.external[].reference.title'),
        locator: asString(ref.locator, 'brief.external[].reference.locator'),
      },
    };
  });
}

function normalizeBriefCompatibility(value: unknown): BriefCompatibility {
  const o = asObj(value, 'brief.compatibility');
  const guarantees = asArray(o.guarantees, 'brief.compatibility.guarantees').map((item) => {
    const g = asObj(item, 'brief.compatibility.guarantees[]');
    return {
      subject: asString(g.subject, 'brief.compatibility.guarantees[].subject'),
      version_range: asString(g.version_range, 'brief.compatibility.guarantees[].version_range'),
      breaks_if: asString(g.breaks_if, 'brief.compatibility.guarantees[].breaks_if'),
    };
  });
  const out: BriefCompatibility = { guarantees };
  if (o.migration_path != null) out.migration_path = asString(o.migration_path, 'brief.compatibility.migration_path');
  return out;
}

function normalizeBriefLimits(value: unknown): BriefLimit[] {
  const arr = asArray(value, 'brief.limits');
  return arr.map((item): BriefLimit => {
    const l = asObj(item, 'brief.limits[]');
    return {
      id: asId(l.id, 'brief.limits[].id', ID_PATTERNS.limit),
      statement: asString(l.statement, 'brief.limits[].statement'),
    };
  });
}

const VALID_CRITERION_TYPES = ['numeric', 'binary', 'verification'];

function normalizeBriefCriteria(value: unknown): BriefCriterion[] {
  const arr = asArray(value, 'brief.criteria');
  return arr.map((item): BriefCriterion => {
    const c = asObj(item, 'brief.criteria[]');
    if (typeof c.type !== 'string' || !VALID_CRITERION_TYPES.includes(c.type)) {
      throw new CardValidationError(`Invalid brief.criteria[].type (expected one of: ${VALID_CRITERION_TYPES.join(', ')})`);
    }
    const m = asObj(c.measure, 'brief.criteria[].measure');
    let measure: BriefCriterion['measure'];
    if (c.type === 'numeric') {
      if (typeof m.value !== 'number') throw new CardValidationError('Invalid brief.criteria[].measure.value (numeric type requires number)');
      if (typeof m.comparator !== 'string' || !VALID_COMPARATORS.includes(m.comparator)) {
        throw new CardValidationError(`Invalid brief.criteria[].measure.comparator (expected one of: ${VALID_COMPARATORS.join(', ')})`);
      }
      measure = {
        value: m.value,
        comparator: m.comparator as '<' | '<=' | '=' | '>=' | '>',
        unit: asString(m.unit, 'brief.criteria[].measure.unit'),
      };
    } else if (c.type === 'binary') {
      measure = { predicate: asString(m.predicate, 'brief.criteria[].measure.predicate') };
    } else {
      measure = {
        method: asString(m.method, 'brief.criteria[].measure.method'),
        reference: asString(m.reference, 'brief.criteria[].measure.reference'),
      };
    }
    return {
      id: asId(c.id, 'brief.criteria[].id', ID_PATTERNS.criterion),
      type: c.type as BriefCriterion['type'],
      measure,
      verifies: asStringArray(c.verifies, 'brief.criteria[].verifies'),
    };
  });
}

function normalizeBriefRationale(value: unknown): BriefRationale {
  const o = asObj(value, 'brief.rationale');
  const alternatives = asArray(o.alternatives, 'brief.rationale.alternatives').map((item) => {
    const a = asObj(item, 'brief.rationale.alternatives[]');
    return {
      option: asString(a.option, 'brief.rationale.alternatives[].option'),
      pros: asStringArray(a.pros, 'brief.rationale.alternatives[].pros'),
      cons: asStringArray(a.cons, 'brief.rationale.alternatives[].cons'),
    };
  });
  if (alternatives.length < 2) {
    throw new CardValidationError('brief.rationale.alternatives must have at least 2 entries (chosen + at least 1 compared)');
  }
  const chosen = asObj(o.chosen, 'brief.rationale.chosen');
  const out: BriefRationale = {
    alternatives,
    chosen: {
      option: asString(chosen.option, 'brief.rationale.chosen.option'),
      reasoning: asString(chosen.reasoning, 'brief.rationale.chosen.reasoning'),
    },
    addresses: asStringArray(o.addresses, 'brief.rationale.addresses'),
  };
  if (o.trade_off != null) out.trade_off = asString(o.trade_off, 'brief.rationale.trade_off');
  return out;
}

function normalizeBriefBody(value: unknown): BriefBody {
  const o = asObj(value, 'brief');
  return {
    context: normalizeBriefContext(o.context),
    scope: normalizeBriefScope(o.scope),
    flow: normalizeBriefFlow(o.flow),
    design: normalizeBriefDesign(o.design),
    policy: normalizeBriefPolicy(o.policy),
    external: normalizeBriefExternal(o.external),
    compatibility: normalizeBriefCompatibility(o.compatibility),
    limits: normalizeBriefLimits(o.limits),
    criteria: normalizeBriefCriteria(o.criteria),
    rationale: normalizeBriefRationale(o.rationale),
  };
}

// ── Spec body normalizers ──────────────────────────────────────

const VALID_SPEC_KEYWORDS = ['MUST', 'SHALL'];
const VALID_ALWAYS_HOLDS = ['per-call', 'cross-call', 'cross-process'];

function normalizeBinds(value: unknown, field: string): SpecBindRef[] {
  const arr = asArray(value, field);
  return arr.map((item) => {
    const b = asObj(item, `${field}[]`);
    return {
      file: asString(b.file, `${field}[].file`),
      symbol: asString(b.symbol, `${field}[].symbol`),
    };
  });
}

function normalizeDomainBody(value: unknown): DomainBody {
  const o = asObj(value, 'domain');
  const body: DomainBody = {
    overview: asString(o.overview, 'domain.overview'),
    scope: asString(o.scope, 'domain.scope'),
  };
  if (o.cross_domain_dependencies != null) {
    body.cross_domain_dependencies = asArray(
      o.cross_domain_dependencies,
      'domain.cross_domain_dependencies',
    ).map((item) => {
      const d = asObj(item, 'domain.cross_domain_dependencies[]');
      return {
        domain: asString(d.domain, 'domain.cross_domain_dependencies[].domain'),
        relationship: asString(d.relationship, 'domain.cross_domain_dependencies[].relationship'),
      };
    });
  }
  return body;
}

function normalizeSpecBody(value: unknown): SpecBody {
  const o = asObj(value, 'spec');
  const preconditions = asArray(o.preconditions, 'spec.preconditions').map((item): SpecPrecondition => {
    const p = asObj(item, 'spec.preconditions[]');
    return {
      id: asString(p.id, 'spec.preconditions[].id'),
      condition: asString(p.condition, 'spec.preconditions[].condition'),
      binds: normalizeBinds(p.binds, 'spec.preconditions[].binds'),
      derives: asString(p.derives, 'spec.preconditions[].derives'),
    };
  });
  const postconditions = asArray(o.postconditions, 'spec.postconditions').map((item): SpecPostcondition => {
    const p = asObj(item, 'spec.postconditions[]');
    if (typeof p.keyword !== 'string' || !VALID_SPEC_KEYWORDS.includes(p.keyword)) {
      throw new CardValidationError(`Invalid spec.postconditions[].keyword (expected one of: ${VALID_SPEC_KEYWORDS.join(', ')})`);
    }
    return {
      id: asString(p.id, 'spec.postconditions[].id'),
      guarantee: asString(p.guarantee, 'spec.postconditions[].guarantee'),
      keyword: p.keyword as SpecPostcondition['keyword'],
      binds: normalizeBinds(p.binds, 'spec.postconditions[].binds'),
      derives: asString(p.derives, 'spec.postconditions[].derives'),
    };
  });
  const invariants = asArray(o.invariants, 'spec.invariants').map((item): SpecInvariant => {
    const i = asObj(item, 'spec.invariants[]');
    if (typeof i.always_holds !== 'string' || !VALID_ALWAYS_HOLDS.includes(i.always_holds)) {
      throw new CardValidationError(`Invalid spec.invariants[].always_holds (expected one of: ${VALID_ALWAYS_HOLDS.join(', ')})`);
    }
    return {
      id: asString(i.id, 'spec.invariants[].id'),
      statement: asString(i.statement, 'spec.invariants[].statement'),
      binds: normalizeBinds(i.binds, 'spec.invariants[].binds'),
      always_holds: i.always_holds as SpecInvariant['always_holds'],
    };
  });
  const failures = asArray(o.failures, 'spec.failures').map((item): SpecFailure => {
    const f = asObj(item, 'spec.failures[]');
    const ex = asObj(f.exception, 'spec.failures[].exception');
    return {
      violation: asString(f.violation, 'spec.failures[].violation'),
      behavior: asString(f.behavior, 'spec.failures[].behavior'),
      exception: {
        class: asString(ex.class, 'spec.failures[].exception.class'),
        file: asString(ex.file, 'spec.failures[].exception.file'),
      },
    };
  });
  const body: SpecBody = { preconditions, postconditions, invariants, failures };
  if (o.state_transitions != null) {
    body.state_transitions = asArray(o.state_transitions, 'spec.state_transitions').map((item): SpecStateTransition => {
      const t = asObj(item, 'spec.state_transitions[]');
      return {
        from: asString(t.from, 'spec.state_transitions[].from'),
        trigger: asString(t.trigger, 'spec.state_transitions[].trigger'),
        to: asString(t.to, 'spec.state_transitions[].to'),
        binds: normalizeBinds(t.binds, 'spec.state_transitions[].binds'),
      };
    });
  }
  return body;
}

// ── Coerce frontmatter ────────────────────────────────────────

function coerceFrontmatter(doc: unknown): CardFrontmatter {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new CardValidationError('Invalid frontmatter: expected YAML object');
  }

  const fm = doc as Record<string, unknown>;

  const status = fm['status'];
  if (!isCardStatus(status)) {
    throw new CardValidationError('Invalid frontmatter field: status');
  }

  const out: CardFrontmatter = {
    key: asString(fm['key'], 'key'),
    summary: asString(fm['summary'], 'summary'),
    status,
    type: normalizeCardType(fm['type']),
  };

  if (fm['parent'] != null) {
    out.parent = asString(fm['parent'], 'parent');
  }

  const boundary = normalizeBoundary(fm['boundary']);
  if (boundary !== undefined) out.boundary = boundary;

  const relations = normalizeRelations(fm['relations']);
  if (relations !== undefined) out.relations = relations;

  const codeLinks = normalizeCodeLinks(fm['codeLinks']);
  if (codeLinks !== undefined) out.codeLinks = codeLinks;

  const tags = normalizeTags(fm['tags']);
  if (tags !== undefined) out.tags = tags;

  const glossary = normalizeGlossary(fm['glossary']);
  if (glossary !== undefined) out.glossary = glossary;

  // ── Type-specific structured bodies ──────────────────────────
  if (fm['principle'] != null) {
    out.principle = normalizePrincipleBody(fm['principle']);
  }
  if (fm['domain'] != null) {
    out.domain = normalizeDomainBody(fm['domain']);
  }
  if (fm['brief'] != null) {
    out.brief = normalizeBriefBody(fm['brief']);
  }
  if (fm['spec'] != null) {
    out.spec = normalizeSpecBody(fm['spec']);
  }

  return out;
}

export function parseCardMarkdown(markdown: string): CardFile {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split('\n');

  if (lines[0] !== '---') {
    throw new CardValidationError('Missing YAML frontmatter');
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }

  if (end === -1) {
    throw new CardValidationError('Unterminated YAML frontmatter');
  }

  const yamlText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');

  let doc: unknown;
  try {
    doc = Bun.YAML.parse(yamlText);
  } catch (err) {
    throw new CardValidationError(
      `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (Array.isArray(doc)) {
    throw new CardValidationError('Invalid frontmatter: multi-document YAML is not allowed');
  }

  const frontmatter = coerceFrontmatter(doc);
  return { frontmatter, body };
}

export function serializeCardMarkdown(frontmatter: CardFrontmatter, body: string): string {
  const yaml = (Bun.YAML.stringify(frontmatter) ?? '').trimEnd();
  const header = `---\n${yaml}\n---\n`;
  return header + body;
}
