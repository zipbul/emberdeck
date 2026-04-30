> ⚠️ **Historical document.** Written when emberdeck shipped as an MCP server. emberdeck is now CLI-only (commit `c23851b`); MCP-specific paths and tool registrations in this file no longer apply. Design intent and analysis content remain valid.

# Design: Brief System for Emberdeck

Date: 2026-04-06
Status: Draft (v2 — post gap analysis)

## Problem

Vibe coding skips the planning (기획) phase. AI generates code from prompts without defining motivation, scope, policies, terminology, or scenarios first. This causes:

- **Logic Drift**: Business rules mutate silently across sessions (CodeRabbit: 1.64x more quality issues)
- **Terminology inconsistency**: Same concept gets different names per session (DDD Ubiquitous Language violation)
- **Policy violations**: AI generates arbitrary magic numbers (refund period, discount limits)
- **Missing edge cases**: Only happy path implemented, no exception handling
- **Architectural drift**: After 6 months of vibe coding, actual behavior diverges from intended business rules

Source: docs/research-planning-docs-dev-perspective.md, docs/research-service-planning-docs.md

## Research-Backed Design Constraints

### C1: Briefs are multiple documents, not one
Non-trivial services always split into multiple documents.
(Source: industrialempathy.com, projectmanager.com)

### C2: Brief elements form a graph, not a tree
~20% of requirements cause 75% of interdependencies.
(Source: Springer, Inderscience)

### C3: Cross-cutting elements need central management
Glossary terms span multiple features. Policies are part of the brief content itself.
(Source: GovStack, IEEE)

### C4: Brief ↔ Spec relationship is not fixed hierarchy
Specs can exist without briefs. Briefs can exist without specs.
(Source: IEEE 29148, YC)

### C5: Structured specs improve AI output by ~35%
But longer context hurts AI performance. Brief content must be concise and retrievable on demand.
(Source: Tessl benchmark, Chroma Context Rot)

### C6: Distributed documents cause more inconsistency
Resolution: modular units with single-source-of-truth per concern.
(Source: UCL Nentwich 2005, Springer)

### C7: 6 sections are insufficient for all domains
External constraints (imposed from outside) and risk/failure analysis are missing. Required by 4/6 tested domains (medical, financial, government, open source).
(Source: docs/research-brief-system-gaps.md §3)

### C8: Heading-based validation needs generation control, not fuzzy matching
No tool solves synonym/multilingual heading matching. Industry approach: control at generation time.
(Source: docs/research-brief-system-gaps.md §1)

### C9: Content quality requires structural + lexical validation
TBD/placeholder detection and ambiguous term blacklists are immediately applicable. Semantic validation deferred.
(Source: INCOSE 42 Rules, NASA, GitHub TODOCS)

## Design

### Overview

The brief system structures brief card bodies with 8 required sections and validates completeness + content quality. No new card types, fields, or schema changes.

### Required Sections (8)

Derived from cross-format analysis (IEEE SRS, Google Design Doc, RFC, PRD, BMC, Service Blueprint) + domain gap analysis across 6 domains (open source, medical, financial, games, AI/ML, government).

| # | Section | What it covers | Research basis |
|---|---------|---------------|----------------|
| 1 | `## Motivation` | Why this exists. Problem statement, background. | IEEE Purpose, RFC Motivation, BMC Problem |
| 2 | `## Scope` | Goals and non-goals. What we will and will NOT do. | Google Non-Goals, PRD Out-of-scope |
| 3 | `## Scenario` | How users/consumers interact. Happy path flows. | Journey Map, RFC Detailed Design, Service Blueprint |
| 4 | `## Rule` | Internal business rules, policies we define. | IEEE Constraints, Wiegers BR#, SLA/OLA |
| 5 | `## Constraint` | External obligations we cannot change. Regulations, compatibility, legal. | IEC 62304, PCI DSS, WCAG, SemVer (gap analysis §3) |
| 6 | `## Risk` | Failure scenarios, hazards, known limitations, unresolved questions. | ISO 14971, RFC Unresolved Questions (gap analysis §3) |
| 7 | `## Criteria` | How we know it works. Success metrics, acceptance criteria. | PRD KPIs, Lean Canvas Metrics |
| 8 | `## Decision` | Alternatives considered and why we chose this approach. | Google Alternatives, RFC Rejected Ideas, ADR |

**Why Rule and Constraint are separate:**
- Rule = "we decided refund within 7 days" → changeable by us
- Constraint = "GDPR requires data deletion within 30 days" → imposed externally, cannot change
- 4/6 tested domains require this distinction (medical, financial, government, open source)

**Why Risk is separate from Scenario:**
- Scenario = happy path, how things should work
- Risk = failure path, what can go wrong, known limitations
- 4/6 tested domains require explicit failure analysis

**Domain extensions:**
Projects can add domain-specific sections beyond the 8 required ones. The 8 are the universal minimum validated across all domains.

Hardcoded defaults:
```typescript
const REQUIRED_BRIEF_SECTIONS = [
  'motivation',
  'scope',
  'scenario',
  'rule',
  'constraint',
  'risk',
  'criteria',
  'decision',
] as const;
```

### Heading Validation Strategy

**Generation control** (not fuzzy matching):
- SKILL.md instructs AI to use exact English headings: `## Motivation`, `## Scope`, etc.
- `validate_brief` uses **case-insensitive exact matching** after trimming whitespace
- This follows the Kiro/spec-kit pattern: control at generation time, minimal post-validation

Rationale: No tool solves synonym/multilingual heading matching (docs/research-brief-system-gaps.md §1). Controlling generation is simpler and more reliable than post-hoc fuzzy matching.

### Content Quality Validation

Two layers applied by `validate_brief`:

**L1 — Structural checks:**
- Section body is not empty
- Section body has at least 2 sentences (reject single-sentence stubs)
- No placeholder markers: `TBD`, `TODO`, `FIXME`, `TBC`, `N/A`, `...`

**L2 — Lexical checks (INCOSE-based):**
Warn (not error) on ambiguous terms commonly found in weak requirements:

```typescript
const AMBIGUOUS_TERMS = [
  // INCOSE R7: Vague terms
  'some', 'several', 'many', 'few', 'adequate', 'sufficient',
  'reasonable', 'appropriate', 'normal', 'typical',
  // INCOSE R8: Escape clauses
  'where possible', 'as appropriate', 'if practical',
  'as needed', 'when necessary',
  // INCOSE R9: Open-ended clauses
  'etc', 'and so on', 'such as', 'including but not limited to',
  // INCOSE R34: Unmeasurable performance
  'fast', 'user-friendly', 'easy', 'intuitive', 'robust',
  'flexible', 'scalable', 'efficient',
] as const;
```

Sources: INCOSE 42 Rules (reqi.io), NASA Appendix C (nasa.gov), GitHub TODOCS pattern

### Intent Card Example

```markdown
---
key: shopping-mall
type: brief
summary: Online shopping mall service brief
status: draft
glossary: [product, sku, option, order, cart]
---

## Motivation

Offline store revenue has plateaued at 200M KRW/year for 3 consecutive years.
Customer surveys indicate 60% would prefer online ordering.
Online channel needed to reach customers beyond geographic limits.
Target: 30% revenue increase within 12 months of launch.

## Scope

### Goals
- Product search with keyword and category filtering
- Cart management (add, remove, quantity adjustment)
- Order placement with payment (card, bank transfer)

### Non-goals
- Delivery tracking (integrate 3rd party API, do not build)
- Review/rating system (phase 2)
- International shipping
- Mobile app (responsive web only for v1)

## Scenario

### Checkout Flow
1. User searches for product by keyword
2. Selects product, chooses options (size, color)
3. Adds to cart
4. Proceeds to checkout, selects payment method
5. Confirms order, receives order confirmation email

### Reorder Flow
1. User opens order history
2. Selects previous order
3. Adds same items to cart (adjusting quantities if needed)

## Rule

- Refund must be processed within 7 days of purchase
- Maximum 2 discounts stacked per order, applied in order: percentage then fixed
- Inventory reserved for 30 minutes during checkout, then released
- Free shipping on orders over 50,000 KRW
- Account locked after 5 consecutive failed login attempts

## Constraint

- 전자상거래법: 7-day unconditional return/refund for online purchases
- 개인정보보호법: User consent required before collecting personal data
- PG (Payment Gateway) settlement: T+2 business days, cannot expedite
- Hosting: Must deploy on existing AWS ap-northeast-2 infrastructure

## Risk

- PG integration failure during peak hours (Chuseok, Black Friday)
  - Mitigation: Circuit breaker + fallback to secondary PG
- Inventory sync delay between offline POS and online stock
  - Mitigation: Real-time sync via webhook, 5-minute polling fallback
- Cart abandonment rate may exceed 60% without UX optimization
  - Accepted risk for v1, measure and iterate in v2
- **Unresolved:** Pricing for bulk/wholesale orders — decision deferred to phase 2

## Criteria

- Conversion rate: 15% within 6 months of launch
- Cart abandonment rate: below 40%
- CS inquiry volume: 30% reduction vs current phone-only
- Page load time: under 2 seconds (LCP)
- Payment success rate: above 98%
- Zero critical security vulnerabilities at launch

## Decision

### Payment Gateway: Stripe over Toss Payments
- Stripe: International support, comprehensive API documentation, webhook reliability
- Toss Payments: Lower domestic fees (2.2% vs 2.9%), but KRW-only
- **Chose Stripe** for future international expansion potential
- Rejected: Direct bank integration (regulatory complexity too high for team size)

### Architecture: Modular Monolith over Microservices
- Team size is 3 engineers — microservices operational overhead unjustifiable
- Modular monolith with clear module boundaries, can split later
- Rejected: Microservices (operational complexity), Serverless (cold start latency for checkout critical path)
```

### Multiple Intent Cards (Large Service)

For larger services, the brief splits across multiple brief cards using parent-child hierarchy:

```
shopping-mall (root brief — may contain all 8 sections or just overview)
├── shopping-mall-product (brief — product domain brief with 8 sections)
├── shopping-mall-order (brief — order domain brief with 8 sections)
├── shopping-mall-payment (brief — payment domain brief with 8 sections)
└── shopping-mall-cs (brief — customer service brief with 8 sections)
```

**When to split** (research-backed criteria):
- Different Ubiquitous Language within same card (DDD boundary signal)
- Multiple teams/services involved
- Cannot complete in one implementation cycle
- Size exceeds ~10-20 pages equivalent

**How to split:**
- Vertical Slice first — split by feature/domain, not by layer
- SPIDR pattern — Spike/Paths/Interfaces/Data/Rules
- Original becomes parent, splits become children
- Each child card has its own 8 sections relevant to its scope

When split, `validate_brief` scans the target card's body AND all descendant brief cards.

### MCP Tool: `emberdeck_validate_brief`

**Input:**
- `cardKey` (required): Brief card key to validate.

**Logic:**
1. Read the target brief card and all descendant brief cards (BFS via parent-child).
2. Parse `## ` headings from all bodies (case-insensitive match).
3. Check required sections against `REQUIRED_BRIEF_SECTIONS`.
4. For each present section, run L1 and L2 quality checks.
5. Return: section presence, quality warnings, and per-section card locations.

**Output example:**
```json
{
  "complete": true,
  "sections": {
    "motivation": {
      "cardKey": "shopping-mall",
      "status": "ok"
    },
    "scope": {
      "cardKey": "shopping-mall",
      "status": "ok"
    },
    "rule": {
      "cardKey": "shopping-mall",
      "status": "warning",
      "warnings": ["Contains ambiguous term: 'as needed' (INCOSE R8)"]
    },
    "risk": {
      "cardKey": "shopping-mall",
      "status": "ok"
    }
  },
  "missing": [],
  "qualityWarnings": 1
}
```

### Brief Change Impact Tracking

When an brief card's body is updated:
1. Detect which `## ` sections changed (diff previous vs new body).
2. Find all spec cards connected via `relations` or `parent-child`.
3. If changed section is `## Rule`, `## Constraint`, or `## Risk`, flag connected spec cards for review.
4. Surface this in `emberdeck_pre_change_check` output.

This leverages existing infrastructure: `get_relation_graph` (BFS), `check_drift`, `cardChangelog`.

### Integration Points

- **SKILL.md**: Instructs AI to write 8 brief sections in brief cards before creating specs. Instructs AI to call `validate_brief` before proceeding to spec creation.
- **`emberdeck_analyze`**: Includes brief completeness + quality as a section.
- **`emberdeck_onboarding_summary`**: Mentions brief completion status.
- **`emberdeck_pre_change_check`**: Surfaces brief context (rules, constraints, risks) when modifying code.

### Cross-Cutting Policies

Policies spanning multiple features:
- Write as `## Rule` or `## Constraint` section in an brief card
- Other cards reference via `relations: [policy-card-key]`
- `emberdeck_get_card_context` traverses relations to surface relevant policies

Glossary remains the only separate central system (terms are simple key-value; policies are substantive content in cards).

## Not Changed

| Item | Reason |
|------|--------|
| Card types (brief/spec) | No new types needed |
| CardFrontmatter schema | No new fields |
| Database schema | No migration needed |
| Parent-child hierarchy rules | Already flexible |
| Relation structure | Untyped relations sufficient |
| Glossary system | Works as-is |
| Spec card behavior | Unaffected |

## Implementation Scope

### New Files
- `src/brief/validate.ts` — section parsing, completeness check, L1/L2 quality checks

### New MCP Tool (1)
- `emberdeck_validate_brief`

### Modified Files
- `src/mcp/tools.ts` — register validate_brief tool
- `SKILL.md` — add brief writing instructions (8 sections, exact headings)

### Constants
- `REQUIRED_BRIEF_SECTIONS` — 8 required section headings
- `AMBIGUOUS_TERMS` — INCOSE-based term blacklist for L2 warnings

### Total Changes
- New fields: 0
- Schema changes: 0
- New files: 1
- New MCP tools: 1
- Modified files: 2

## Deferred

| Item | Reason | Priority |
|------|--------|----------|
| Typed relations | Valuable but not blocking. Types: references, constrains, implements, extends, conflicts | Medium |
| L3 semantic quality (LLM-based) | Requires LLM call in validation, complex | Low |
| Conflict detection between briefs | ALICE approach (formal logic + LLM). Needs research spike | Low |
| Domain-specific section templates | Games need creative direction, AI/ML needs data requirements | After v1 |

## Workflow

```
User: "Make a shopping mall"

Step 1 — AI reads SKILL.md, knows 8 required sections

Step 2 — AI creates brief card with structured body:
  ## Motivation, ## Scope, ## Scenario, ## Rule,
  ## Constraint, ## Risk, ## Criteria, ## Decision

Step 3 — AI defines glossary terms

Step 4 — AI calls emberdeck_validate_brief(cardKey: "shopping-mall")
  → Checks section presence + content quality (L1 + L2)
  → Returns: complete or missing sections + quality warnings

Step 5 — If incomplete or quality issues, AI fixes

Step 6 — AI creates spec cards under the brief card
  → Spec cards reference brief rules/constraints via relations

Step 7 — AI writes code, constrained by specs
  → pre_change_check surfaces brief context
  → Brief changes flag connected specs for review
```

## Research References

- docs/research-planning-docs-dev-perspective.md
- docs/research-service-planning-docs.md
- docs/research-planning-doc-structure.md
- docs/research-planning-terminology.md
- docs/research-brief-system-gaps.md
