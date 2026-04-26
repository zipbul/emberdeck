/**
 * Lifecycle status of a card.
 *
 * - `draft` — Card authoring in progress or intentional rework.
 * - `active` — In effect. For brief/spec, code is structurally aligned.
 * - `drifted` — Code has diverged (brief/spec only). Not applicable to principle.
 * - `retired` — Principle no longer in effect, kept for historical reference (principle only).
 */
export type CardStatus = 'draft' | 'active' | 'drifted' | 'retired';

/**
 * Card type.
 *
 * - `principle` — Project-wide constraint applying across multiple briefs. No code binding.
 * - `brief` — Designable area: why it exists, scope, constraints, policies. No code binding.
 * - `spec` — Behavioral contract bound to code via codeLinks.
 */
export type CardType = 'principle' | 'brief' | 'spec';

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
  | { value: number; comparator: '<' | '<=' | '=' | '>=' | '>'; unit: string }
  | { predicate: string }
  | { method: string; reference: string };

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

export interface SpecBindRef {
  file: string;
  symbol: string;
}

export interface SpecPrecondition {
  /** ID format: PRE-001 */
  id: string;
  condition: string;
  binds: SpecBindRef[];
  /** Reference to brief item, e.g. "brief-key#R-001" */
  derives: string;
}

export interface SpecPostcondition {
  /** ID format: POST-001 */
  id: string;
  guarantee: string;
  keyword: 'MUST' | 'SHALL';
  binds: SpecBindRef[];
  derives: string;
}

export interface SpecInvariant {
  /** ID format: INV-001 */
  id: string;
  statement: string;
  binds: SpecBindRef[];
  always_holds: 'per-call' | 'cross-call' | 'cross-process';
}

export interface SpecFailure {
  violation: string;
  behavior: string;
  exception: { class: string; file: string };
}

export interface SpecStateTransition {
  from: string;
  trigger: string;
  to: string;
  binds: SpecBindRef[];
}

export interface SpecBody {
  preconditions: SpecPrecondition[];
  postconditions: SpecPostcondition[];
  invariants: SpecInvariant[];
  failures: SpecFailure[];
  state_transitions?: SpecStateTransition[];
}

// ── CardFrontmatter ───────────────────────────────────────────

/**
 * YAML frontmatter structure of a `.card.md` file.
 * Type-specific structured bodies live under `principle` / `brief` / `spec` namespace keys.
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
  /** File/directory glob patterns this card is responsible for. spec only. */
  boundary?: string[];
  /** List of related card keys. */
  relations?: string[];
  /** List of source code symbol references. spec only. */
  codeLinks?: CodeLink[];
  /** List of tags for categorization. Stored as lowercase. */
  tags?: string[];
  /** Glossary words declared by this card. */
  glossary?: string[];

  // ── Type-specific structured bodies ──────────────────────────
  /** principle namespace (only when type=principle) */
  principle?: PrincipleBody;
  /** brief namespace (only when type=brief) */
  brief?: BriefBody;
  /** spec namespace (only when type=spec) */
  spec?: SpecBody;
}

/**
 * Complete representation of a card read from a file.
 */
export interface CardFile {
  /** Parsed frontmatter object. */
  frontmatter: CardFrontmatter;
  /** Optional free-form prose body. Most semantic content lives in frontmatter namespaces. */
  body: string;
  /** Absolute path to the card file. */
  filePath?: string;
}
