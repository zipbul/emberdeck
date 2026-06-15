import jsyaml from 'js-yaml';
import { errorMessage } from '../util/error';
import type {
  BriefAssumption,
  BriefBody,
  BriefContext,
  BriefCriterion,
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
  DomainBody,
  DomainCrossDependency,
  PrincipleBody,
  PrincipleMetric,
  PrincipleStructuralPredicate,
  PrincipleVerify,
  VisionBody,
  SpecBody,
  SpecFailure,
  SpecInvariant,
  SpecInvoke,
  SpecPostcondition,
  SpecPrecondition,
  SpecShape,
  SpecStateTransition,
} from './types';
import { CARD_TYPES } from './types';
import { CardValidationError } from './errors';

function isCardStatus(value: unknown): value is CardStatus {
  return value === 'draft' || value === 'active' || value === 'drifted';
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

// ── Principle body normalizers ─────────────────────────────────

const VALID_ENFORCEMENT = ['blocking', 'warning', 'advisory'];
const VALID_VERIFY_CLASSES = ['structural', 'binding', 'metric', 'prose']; // [§5]
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

const VALID_STRUCTURAL_KINDS = ['forbids-relation-to'];

function normalizeStructuralPredicate(value: unknown): PrincipleStructuralPredicate {
  const o = asObj(value, 'principle.verify.structural');
  if (typeof o.kind !== 'string' || !VALID_STRUCTURAL_KINDS.includes(o.kind)) {
    throw new CardValidationError(`Invalid principle.verify.structural.kind (expected one of: ${VALID_STRUCTURAL_KINDS.join(', ')})`);
  }
  return { kind: 'forbids-relation-to', targetGlob: asString(o.targetGlob, 'principle.verify.structural.targetGlob') };
}

function normalizePrincipleBody(value: unknown): PrincipleBody {
  const o = asObj(value, 'principle');
  if (typeof o.enforcement !== 'string' || !VALID_ENFORCEMENT.includes(o.enforcement)) {
    throw new CardValidationError(`Invalid principle.enforcement (expected one of: ${VALID_ENFORCEMENT.join(', ')})`);
  }
  const enforcement = o.enforcement as PrincipleBody['enforcement'];
  // [§5] verify is REQUIRED — a principle must declare how it is enforced, else
  // it is a silent hollow principle (looks like governance, enforces nothing).
  if (o.verify == null) {
    throw new CardValidationError('principle.verify is required — declare verify.class (structural|binding|metric|prose) so the principle states how it is enforced (no silent hollow principle, §5)');
  }
  const v = asObj(o.verify, 'principle.verify');
  if (typeof v.class !== 'string' || !VALID_VERIFY_CLASSES.includes(v.class)) {
    throw new CardValidationError(`Invalid principle.verify.class (expected one of: ${VALID_VERIFY_CLASSES.join(', ')})`);
  }
  const cls = v.class as PrincipleVerify['class'];
  // Integrity (§5): a class may be `blocking` only if it has an evaluation
  // engine. structural (graph predicate) and binding (@spec source-binding
  // evidence of governed specs) do; prose (human review) and metric (no
  // measurement feed yet) do not — they must be warning/advisory.
  if ((cls === 'prose' || cls === 'metric') && enforcement === 'blocking') {
    throw new CardValidationError(`principle.verify.class "${cls}" cannot be enforcement:blocking (no evaluation engine — prose is human-reviewed, metric needs a measurement feed; use warning or advisory)`);
  }
  const verify: PrincipleVerify = { class: cls };
  if (cls === 'structural') {
    if (v.structural == null) {
      throw new CardValidationError('principle.verify.class "structural" requires a `structural` predicate');
    }
    verify.structural = normalizeStructuralPredicate(v.structural);
  } else if (v.structural != null) {
    throw new CardValidationError(`principle.verify.structural is only valid when class="structural" (got class="${cls}")`);
  }
  const body: PrincipleBody = {
    statement: asString(o.statement, 'principle.statement'),
    rationale: asString(o.rationale, 'principle.rationale'),
    applies_to: normalizeAppliesTo(o.applies_to),
    enforcement,
    verify,
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
  failure: /^FAIL-\d{3,}$/,
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
        predicate: asString(m.predicate, 'brief.criteria[].measure.predicate'),
        value: m.value,
        comparator: m.comparator as '<' | '<=' | '=' | '>=' | '>',
        unit: asString(m.unit, 'brief.criteria[].measure.unit'),
        ...(m.reference !== undefined ? { reference: asString(m.reference, 'brief.criteria[].measure.reference') } : {}),
      };
    } else if (c.type === 'binary') {
      measure = {
        predicate: asString(m.predicate, 'brief.criteria[].measure.predicate'),
        ...(m.method !== undefined ? { method: asString(m.method, 'brief.criteria[].measure.method') } : {}),
        ...(m.reference !== undefined ? { reference: asString(m.reference, 'brief.criteria[].measure.reference') } : {}),
      };
    } else {
      measure = {
        method: asString(m.method, 'brief.criteria[].measure.method'),
        reference: asString(m.reference, 'brief.criteria[].measure.reference'),
        ...(m.predicate !== undefined ? { predicate: asString(m.predicate, 'brief.criteria[].measure.predicate') } : {}),
        ...(m.unit !== undefined ? { unit: asString(m.unit, 'brief.criteria[].measure.unit') } : {}),
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

function normalizeVisionBody(value: unknown): VisionBody {
  const o = asObj(value, 'vision');
  return {
    statement: asString(o.statement, 'vision.statement'),
    rationale: asString(o.rationale, 'vision.rationale'),
    success_direction: asString(o.success_direction, 'vision.success_direction'),
  };
}

function normalizeBriefBody(value: unknown): BriefBody {
  const o = asObj(value, 'brief');
  const body: BriefBody = {
    context: normalizeBriefContext(o.context),
    scope: normalizeBriefScope(o.scope),
    flow: normalizeBriefFlow(o.flow),
    policy: normalizeBriefPolicy(o.policy),
    criteria: normalizeBriefCriteria(o.criteria),
    rationale: normalizeBriefRationale(o.rationale),
  };
  // [opt — design §154] approach / external / limits are optional.
  if (o.approach != null) body.approach = asString(o.approach, 'brief.approach');
  if (o.external != null) body.external = normalizeBriefExternal(o.external);
  if (o.limits != null) body.limits = normalizeBriefLimits(o.limits);
  return body;
}

// ── Spec body normalizers ──────────────────────────────────────

const VALID_SPEC_KEYWORDS = ['MUST', 'SHALL'];
// cross-process removed in v19 (0/56 usage); MSA/distributed gate re-expands non-destructively.
const VALID_ALWAYS_HOLDS = ['per-call', 'cross-call'];
const VALID_SHAPE_ROLES = ['output', 'error-output']; // [v18]
const VALID_INVOKE_KINDS = ['per-call', 'setup']; // [v18]

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
      const dep: DomainCrossDependency = {
        domain: asString(d.domain, 'domain.cross_domain_dependencies[].domain'),
        relationship: asString(d.relationship, 'domain.cross_domain_dependencies[].relationship'),
      };
      if (d.note != null) dep.note = asString(d.note, 'domain.cross_domain_dependencies[].note');
      return dep;
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
      derives: asString(p.derives, 'spec.preconditions[].derives'),
    };
  });
  const postconditions = asArray(o.postconditions, 'spec.postconditions').map((item): SpecPostcondition => {
    const p = asObj(item, 'spec.postconditions[]');
    if (typeof p.keyword !== 'string' || !VALID_SPEC_KEYWORDS.includes(p.keyword)) {
      throw new CardValidationError(`Invalid spec.postconditions[].keyword (expected one of: ${VALID_SPEC_KEYWORDS.join(', ')})`);
    }
    const pc: SpecPostcondition = {
      id: asString(p.id, 'spec.postconditions[].id'),
      guarantee: asString(p.guarantee, 'spec.postconditions[].guarantee'),
      keyword: p.keyword as SpecPostcondition['keyword'],
      derives: asString(p.derives, 'spec.postconditions[].derives'),
    };
    if (p.references != null) pc.references = asString(p.references, 'spec.postconditions[].references');
    return pc;
  });
  const invariants = asArray(o.invariants, 'spec.invariants').map((item): SpecInvariant => {
    const i = asObj(item, 'spec.invariants[]');
    if (typeof i.always_holds !== 'string' || !VALID_ALWAYS_HOLDS.includes(i.always_holds)) {
      throw new CardValidationError(`Invalid spec.invariants[].always_holds (expected one of: ${VALID_ALWAYS_HOLDS.join(', ')})`);
    }
    return {
      id: asString(i.id, 'spec.invariants[].id'),
      statement: asString(i.statement, 'spec.invariants[].statement'),
      always_holds: i.always_holds as SpecInvariant['always_holds'],
    };
  });
  const failures = asArray(o.failures, 'spec.failures').map((item): SpecFailure => {
    const f = asObj(item, 'spec.failures[]');
    const out: SpecFailure = {
      id: asId(f.id, 'spec.failures[].id', ID_PATTERNS.failure),
      violation: asString(f.violation, 'spec.failures[].violation'),
      behavior: asString(f.behavior, 'spec.failures[].behavior'),
    };
    if (f.case_of != null) out.case_of = asString(f.case_of, 'spec.failures[].case_of');
    if (f.owner != null) out.owner = asString(f.owner, 'spec.failures[].owner');
    if (f.references != null) out.references = asString(f.references, 'spec.failures[].references');
    return out;
  });
  const body: SpecBody = { preconditions, postconditions, invariants, failures };
  if (o.shapes != null) {
    body.shapes = asArray(o.shapes, 'spec.shapes').map((item): SpecShape => {
      const s = asObj(item, 'spec.shapes[]');
      if (typeof s.role !== 'string' || !VALID_SHAPE_ROLES.includes(s.role)) {
        throw new CardValidationError(`Invalid spec.shapes[].role (expected one of: ${VALID_SHAPE_ROLES.join(', ')})`);
      }
      const shape: SpecShape = {
        id: asString(s.id, 'spec.shapes[].id'),
        role: s.role as SpecShape['role'],
        schema: asString(s.schema, 'spec.shapes[].schema'),
      };
      if (s.when != null) shape.when = asString(s.when, 'spec.shapes[].when');
      return shape;
    });
  }
  if (o.invokes != null) {
    body.invokes = asArray(o.invokes, 'spec.invokes').map((item): SpecInvoke => {
      const iv = asObj(item, 'spec.invokes[]');
      if (typeof iv.kind !== 'string' || !VALID_INVOKE_KINDS.includes(iv.kind)) {
        throw new CardValidationError(`Invalid spec.invokes[].kind (expected one of: ${VALID_INVOKE_KINDS.join(', ')})`);
      }
      const invoke: SpecInvoke = {
        to: asString(iv.to, 'spec.invokes[].to'),
        kind: iv.kind as SpecInvoke['kind'],
      };
      if (iv.note != null) invoke.note = asString(iv.note, 'spec.invokes[].note');
      return invoke;
    });
  }
  if (o.state_transitions != null) {
    body.state_transitions = asArray(o.state_transitions, 'spec.state_transitions').map((item): SpecStateTransition => {
      const t = asObj(item, 'spec.state_transitions[]');
      return {
        from: asString(t.from, 'spec.state_transitions[].from'),
        trigger: asString(t.trigger, 'spec.state_transitions[].trigger'),
        to: asString(t.to, 'spec.state_transitions[].to'),
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

  const relations = normalizeRelations(fm['relations']);
  if (relations !== undefined) out.relations = relations;

  const tags = normalizeTags(fm['tags']);
  if (tags !== undefined) out.tags = tags;

  const glossary = normalizeGlossary(fm['glossary']);
  if (glossary !== undefined) out.glossary = glossary;

  // ── Type-specific structured bodies ──────────────────────────
  if (fm['vision'] != null) {
    out.vision = normalizeVisionBody(fm['vision']);
  }
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

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** @spec card-model/round-trip/parse-and-serialize */
export function parseCard(text: string): CardFile {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) {
    throw new CardValidationError('Missing YAML frontmatter (expected `---` delimiters)');
  }
  let doc: unknown;
  try {
    doc = jsyaml.load(m[1] ?? '');
  } catch (err) {
    throw new CardValidationError(
      `YAML parse error: ${errorMessage(err)}`,
    );
  }

  if (Array.isArray(doc)) {
    throw new CardValidationError('Invalid card file: top-level array is not allowed');
  }
  if (!doc || typeof doc !== 'object') {
    throw new CardValidationError('Invalid card file: frontmatter must be a YAML mapping');
  }

  const frontmatter = coerceFrontmatter(doc);
  return { frontmatter };
}

/**
 * Canonical key order. Identifying fields first, then schema-relevant
 * common fields, then type-specific namespaces. Two equal CardFrontmatter
 * objects always serialize to identical bytes.
 *
 * @spec card-model/round-trip/parse-and-serialize
 */
const SERIALIZE_KEY_ORDER: ReadonlyArray<keyof CardFrontmatter> = [
  'key', 'summary', 'status', 'type',
  'parent', 'relations', 'tags', 'glossary',
  'vision', 'principle', 'domain', 'brief', 'spec',
];

/** @spec card-model/round-trip/parse-and-serialize */
export function serializeCard(frontmatter: CardFrontmatter): string {
  const ordered: Record<string, unknown> = {};
  for (const k of SERIALIZE_KEY_ORDER) {
    const v = frontmatter[k];
    if (v !== undefined) ordered[k] = v;
  }
  const yaml = jsyaml.dump(ordered, { lineWidth: 80, noRefs: true });
  return `---\n${yaml}---\n`;
}
