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
export type CardType = 'principle' | 'domain' | 'brief' | 'spec';

export const CARD_TYPES: ReadonlyArray<CardType> = ['principle', 'domain', 'brief', 'spec'];

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

export interface PrincipleBody {
  /** The rule itself (MUST/SHALL/SHOULD/MAY statement). */
  statement: string;
  /** Why this rule exists. */
  rationale: string;
  /** Scope: "*" for all cards, or list of card keys / boundary globs. */
  applies_to: '*' | string[];
  /** How violations are handled. */
  enforcement: 'blocking' | 'warning' | 'advisory';
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

export interface BriefDesignComponent {
  name: string;
  responsibility: string;
  interacts_with: string[];
}

export interface BriefDesignDataFlow {
  from: string;
  to: string;
  payload: string;
  trigger: string;
}

export interface BriefDesignInvariant {
  /** ID format: DI-001 */
  id: string;
  statement: string;
}

export interface BriefDesign {
  overview: string;
  components: BriefDesignComponent[];
  data_flow: BriefDesignDataFlow[];
  invariants: BriefDesignInvariant[];
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

export interface BriefCompatibility {
  guarantees: Array<{ subject: string; version_range: string; breaks_if: string }>;
  migration_path?: string;
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
  design: BriefDesign;
  policy: BriefPolicy[];
  external: BriefExternal[];
  compatibility: BriefCompatibility;
  limits: BriefLimit[];
  criteria: BriefCriterion[];
  rationale: BriefRationale;
}

// ── Spec structured body ──────────────────────────────────────
// Binding to source is via `@spec card-key` JSDoc annotations in code.

export interface SpecPrecondition {
  /** ID format: PRE-001 */
  id: string;
  condition: string;
  /** Reference to brief item, e.g. "brief-key#R-001" */
  derives: string;
}

export interface SpecPostcondition {
  /** ID format: POST-001 */
  id: string;
  guarantee: string;
  keyword: 'MUST' | 'SHALL';
  derives: string;
}

export interface SpecInvariant {
  /** ID format: INV-001 */
  id: string;
  statement: string;
  // cross-process removed in v19 (0/56 usage); MSA/distributed gate re-expands non-destructively.
  always_holds: 'per-call' | 'cross-call';
}

export interface SpecFailure {
  violation: string;
  behavior: string;
}

export interface SpecStateTransition {
  from: string;
  trigger: string;
  to: string;
}

export interface SpecBody {
  preconditions: SpecPrecondition[];
  postconditions: SpecPostcondition[];
  invariants: SpecInvariant[];
  failures: SpecFailure[];
  state_transitions?: SpecStateTransition[];
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
}

export interface DomainBody {
  /** Plain prose: what this domain is, why it exists. */
  overview: string;
  /** Plain prose: scope boundaries, what is in vs out. */
  scope: string;
  /** Optional: explicit cross-domain dependencies. */
  cross_domain_dependencies?: DomainCrossDependency[];
}

// ── CardFrontmatter ───────────────────────────────────────────

/**
 * Top-level structure of a card's `.md` file frontmatter.
 * Type-specific structured bodies live under `principle` / `domain` / `brief` / `spec` namespace keys.
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
