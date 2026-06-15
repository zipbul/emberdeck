/**
 * Lifecycle status of a card.
 *
 * - `draft` — Card authoring in progress or intentional rework.
 * - `active` — In effect. For brief/spec, code is structurally aligned.
 * - `drifted` — Code has diverged (brief/spec only). Not applicable to principle.
 */
export type CardStatus = 'draft' | 'active' | 'drifted';

export const CARD_STATUSES: ReadonlyArray<CardStatus> = ['draft', 'active', 'drifted'];

/** Type-guard: narrow an unknown string to CardStatus. */
export function isCardStatus(value: unknown): value is CardStatus {
  return typeof value === 'string' && (CARD_STATUSES as readonly string[]).includes(value);
}

/**
 * Card type — strict 4-tier hierarchy (principle/domain/brief/spec).
 *
 * - `principle` — Project-wide invariant (cross-cutting). Root-level only, no children.
 * - `domain`    — Bounded context / large area overview. Root-level only; children must be brief.
 * - `brief`     — Design topic within a domain. Structure lives in frontmatter.brief namespace (10 fields, cross-refs validated). Parent MUST be domain (no brief recursion).
 * - `spec`      — Code contract with codeLinks. Parent must be brief or spec (sub-spec allowed).
 *
 * Each type is an abstraction layer; same-level different aspects belong to sections within a card.
 * Bloat at one level resolves by adding sibling cards (briefs) or sub-spec (spec recursion only).
 */
export type CardType = 'vision' | 'principle' | 'domain' | 'brief' | 'spec';

export const CARD_TYPES: ReadonlyArray<CardType> = ['vision', 'principle', 'domain', 'brief', 'spec'];

/** Type-guard: narrow an unknown string to CardType. */
export function isCardType(value: unknown): value is CardType {
  return typeof value === 'string' && (CARD_TYPES as readonly string[]).includes(value);
}

/**
 * A record linking a card to a source code symbol (gildash integration).
 * Code link functionality is only enabled when `EmberdeckOptions.projectRoot` is configured.
 */
export interface CodeLink {
  /** gildash SymbolKind (e.g. `'function'` | `'class'` | `'variable'` | ...) */
  kind: string;
  /** Relative path from the project root (e.g. `'src/auth/token.ts'`) */
  file: string;
  /** Exact symbol name (e.g. `'refreshToken'`) */
  symbol: string;
}

// ── Principle structured body ─────────────────────────────────

/**
 * Quantitative metric attached to a principle.
 * - `kind: "threshold"` — single point-in-time threshold (e.g., latency p99 < 200ms)
 * - `kind: "budget"` — shared/distributable quota over a window (e.g., frame budget 16.67ms)
 */
export interface PrincipleMetric {
  name: string;
  threshold: number;
  unit: string;
  comparator: '<' | '<=' | '=' | '>=' | '>';
  kind?: 'threshold' | 'budget';
  window_kind?: 'static' | 'per_cycle' | 'rolling' | 'calendar';
  distributable?: boolean;
}

/**
 * [§5] How a principle declares it is checked. `class` decides "what is a
 * violation": structural (closed predicate over the card graph) / binding (the
 * SPEC cards it governs carry @spec source-binding evidence — code_link presence;
 * @spec is the only code-binding mechanism per source-as-binding-sot) / metric
 * (PrincipleMetric budget) / prose (human review). Enforcement strength = class ×
 * enforcement, bounded by integrity rules (prose/metric may not be `blocking`).
 */
/**
 * [§5 engine] Closed structural predicate evaluated over a principle's
 * applies_to scope by `validate cards`. Bounded named registry (not a DSL).
 * - forbids-relation-to: no in-scope card may point a forward edge — `relations`,
 *   `cross_domain_dependencies`, or spec `invokes` — at a card key matching
 *   `targetGlob` (boundary enforcement — e.g. one domain may not couple to another).
 *
 * (A `requires-child-type` predicate was removed: 4-tier fixes child types, so it
 * could only ever duplicate the hard-coded `empty-tree` check or assert a
 * nonsensical spec→spec requirement — §5 forbids double-ownership.)
 */
export type PrincipleStructuralPredicate =
  | { kind: 'forbids-relation-to'; targetGlob: string };

export interface PrincipleVerify {
  class: 'structural' | 'binding' | 'metric' | 'prose';
  /** Required when class='structural'; forbidden otherwise. The predicate the engine evaluates. */
  structural?: PrincipleStructuralPredicate;
}

export interface PrincipleBody {
  /** The rule itself (MUST/SHALL/SHOULD/MAY statement). */
  statement: string;
  /** Why this rule exists. */
  rationale: string;
  /** Scope: "*" for all cards, or list of card keys / boundary globs. */
  applies_to: '*' | string[];
  /** How violations are handled. */
  enforcement: 'blocking' | 'warning' | 'advisory';
  /** [§5] declared verification method. Required — every principle must state
   * how it is enforced (structural|binding|metric|prose); absence = silent
   * hollow principle. */
  verify: PrincipleVerify;
  metric?: PrincipleMetric[];
  exemptions?: Array<{ target: string; reason: string }>;
  references?: Array<{ title: string; url: string }>;
}

// ── Brief structured body ─────────────────────────────────────

export interface BriefImpact {
  statement: string;
  metric?: { value: number; unit: string };
}

export interface BriefContext {
  problem: string;
  impact: BriefImpact[];
}

export interface BriefGoal {
  /** ID format: G-001 */
  id: string;
  statement: string;
}

export interface BriefNonGoal {
  /** ID format: NG-001 */
  id: string;
  statement: string;
}

export interface BriefAssumption {
  /** ID format: A-001 */
  id: string;
  statement: string;
  verification?: string;
  reevaluate_when?: string;
}

export interface BriefScope {
  goals: BriefGoal[];
  non_goals: BriefNonGoal[];
  assumptions: BriefAssumption[];
}

export interface BriefFlow {
  /** ID format: S-H-01 (happy) or S-F-01 (failure) */
  id: string;
  kind: 'happy' | 'failure';
  given: string;
  when: string;
  then: string;
  /** Goal IDs this scenario covers. Cross-ref to scope.goals[].id */
  covers: string[];
}

export interface BriefPolicy {
  /** ID format: R-001 */
  id: string;
  subject: string;
  keyword: 'MUST' | 'MUST NOT' | 'SHALL' | 'SHALL NOT' | 'SHOULD' | 'SHOULD NOT' | 'MAY';
  predicate: string;
  /** Flow IDs this policy governs. Cross-ref to flow[].id */
  governs: string[];
}

export interface BriefExternal {
  /** ID format: C-001 */
  id: string;
  statement: string;
  reference: { title: string; locator: string };
}


export interface BriefLimit {
  /** ID format: KL-001 */
  id: string;
  statement: string;
}

export type BriefCriterionMeasure =
  | { predicate: string; value: number; comparator: '<' | '<=' | '=' | '>=' | '>'; unit: string; reference?: string }   // numeric
  | { predicate: string; method?: string; reference?: string }                                                            // binary
  | { method: string; reference: string; predicate?: string; unit?: string };                                             // verification

export interface BriefCriterion {
  /** ID format: SC-001 */
  id: string;
  type: 'numeric' | 'binary' | 'verification';
  measure: BriefCriterionMeasure;
  /** Flow IDs this criterion verifies. Cross-ref to flow[].id */
  verifies: string[];
}

export interface BriefRationale {
  /** Minimum 2 entries required (chosen + at least 1 alternative). */
  alternatives: Array<{ option: string; pros: string[]; cons: string[] }>;
  chosen: { option: string; reasoning: string };
  trade_off?: string;
  /** External or Limits IDs this decision addresses. Cross-ref to external[].id or limits[].id */
  addresses: string[];
}

export interface BriefBody {
  context: BriefContext;
  scope: BriefScope;
  flow: BriefFlow[];
  policy: BriefPolicy[];
  criteria: BriefCriterion[];
  rationale: BriefRationale;
  /** [opt — design §154 "6 req + 3 opt"] Conceptual design prose. */
  approach?: string;
  /** [opt] genuine external references only. */
  external?: BriefExternal[];
  /** [opt] known limitations. */
  limits?: BriefLimit[];
}

// ── Spec structured body ──────────────────────────────────────
// Binding to source is via `@spec card-key` JSDoc annotations in code.

export interface SpecPrecondition {
  /** ID format: PRE-001 */
  id: string;
  condition: string;
  /** Reference to the spec's ancestor-brief GOAL, e.g. "brief-key#G-001" (§5: derives→goal). */
  derives: string;
}

export interface SpecPostcondition {
  /** ID format: POST-001 */
  id: string;
  guarantee: string;
  keyword: 'MUST' | 'SHALL';
  /** Reference to the spec's ancestor-brief GOAL, e.g. "brief-key#G-001" (§5: derives→goal). */
  derives: string;
  /** [v18] shape-ref → spec.shapes[].id (form is owned by shapes, not duplicated in prose). */
  references?: string;
}

export interface SpecInvariant {
  /** ID format: INV-001 */
  id: string;
  statement: string;
  // cross-process removed in v19 (0/56 usage); MSA/distributed gate re-expands non-destructively.
  always_holds: 'per-call' | 'cross-call';
}

export interface SpecFailure {
  /** ID format: FAIL-001 (required — deck fully backfilled). */
  id: string;
  violation: string;
  behavior: string;
  /** [v18] trace → brief#S-F (any failure mode that maps to a user-rejection flow). */
  case_of?: string;
  /** [v18] canonical owner spec-key for a cross-domain-replicated failure (dedup). */
  owner?: string;
  /** [v18] FAIL-id of the canonical failure this one mirrors (dedup). */
  references?: string;
}

export interface SpecStateTransition {
  from: string;
  trigger: string;
  to: string;
}

/** [v18] IO/error form contract owned by a spec. SHP id is deck-global (owner-uniqueness). */
export interface SpecShape {
  /** ID format: SHP-001 (deck-global). */
  id: string;
  role: 'output' | 'error-output';
  when?: string;
  /** Single fenced-block form declaration (no nested-node tree). */
  schema: string;
}

/** [v18] Cross-domain per-call dependency edge owned by the caller spec. */
export interface SpecInvoke {
  /** Target spec key. */
  to: string;
  kind: 'per-call' | 'setup';
  note?: string;
}

export interface SpecBody {
  preconditions: SpecPrecondition[];
  postconditions: SpecPostcondition[];
  invariants: SpecInvariant[];
  failures: SpecFailure[];
  state_transitions?: SpecStateTransition[];
  /** [v18] IO/error form contracts. */
  shapes?: SpecShape[];
  /** [v18] cross-domain per-call dependency edges. */
  invokes?: SpecInvoke[];
}

// ── Domain body ─────────────────────────────────────────────
/**
 * Lightweight namespace for `domain` cards (bounded-context overview).
 *
 * Intentionally smaller than brief: a domain just needs to announce what it
 * covers and which other domains it depends on. Detailed design lives in
 * brief children of the domain.
 */
export interface DomainCrossDependency {
  /** Sibling domain key this domain depends on. */
  domain: string;
  /** One-line description of how the dependency is used (e.g. "consumes events", "shares schema"). */
  relationship: string;
  /** [v18] free-text original preserved when relationship is narrowed to the invokes|consumes enum. */
  note?: string;
}

export interface DomainBody {
  /** Plain prose: what this domain is, why it exists. */
  overview: string;
  /** Plain prose: scope boundaries, what is in vs out. */
  scope: string;
  /** Optional: explicit cross-domain dependencies. */
  cross_domain_dependencies?: DomainCrossDependency[];
}

/**
 * Namespace for `vision` cards — the single enforcement-free root node that
 * states the project's direction (CARD_MODEL_DESIGN §9.1). All fields required.
 * No `applies_to`/`enforcement` (that is principle's normative territory);
 * vision states *where the project is going*, not a rule it enforces.
 */
export interface VisionBody {
  /** Why the project exists and where it is going, stated as direction (not a feature list). */
  statement: string;
  /** The problem/background that justifies this direction; the root every lower decision traces back to. */
  rationale: string;
  /** Qualitative picture of the project heading the right way (not a numeric KPI — that is principle.metric). */
  success_direction: string;
}

// ── CardFrontmatter ───────────────────────────────────────────

/**
 * Top-level structure of a card's `.md` file frontmatter.
 * Type-specific structured bodies live under `vision` / `principle` / `domain` / `brief` / `spec` namespace keys.
 */
export interface CardFrontmatter {
  /** Unique card identifier. Must match the file path slug. */
  key: string;
  /** Required one-line summary of the card. */
  summary: string;
  /** Current lifecycle status of the card. */
  status: CardStatus;
  /** Card type (principle, brief, spec). Required. */
  type: CardType;
  /** Parent card key. brief/spec only. */
  parent?: string;
  /** List of related card keys. */
  relations?: string[];
  /** List of tags for categorization. Stored as lowercase. */
  tags?: string[];
  /** Glossary words declared by this card. */
  glossary?: string[];

  // ── Type-specific structured bodies ──────────────────────────
  /** vision namespace (only when type=vision) */
  vision?: VisionBody;
  /** principle namespace (only when type=principle) */
  principle?: PrincipleBody;
  /** domain namespace (only when type=domain) */
  domain?: DomainBody;
  /** brief namespace (only when type=brief) */
  brief?: BriefBody;
  /** spec namespace (only when type=spec) */
  spec?: SpecBody;
}

/**
 * Complete representation of a card read from a file.
 * Cards are `.md` files with structured YAML frontmatter; body is optional free-form prose.
 */
export interface CardFile {
  /** Parsed frontmatter object. */
  frontmatter: CardFrontmatter;
  /** Absolute path to the card file. */
  filePath?: string;
}
