# Research: Brief System Gap Analysis

Date: 2026-04-06

## Summary
Investigation into 6 identified gaps in the brief system design. All findings source-backed.

---

## 1. Heading Parsing Robustness

**Problem:** AI might write "## 동기" instead of "## Motivation", breaking heading-based validation.

**Finding:** No tool solves synonym/multilingual heading matching. Industry approach: avoid the problem.

Three viable approaches:
- **Generation control**: Tell AI exact headings to use (Kiro, spec-kit approach)
- **Machine-readable markers**: `<!-- @section: motivation -->` separate from human headings (Structured MADR)
- **Regex allowlist**: `(Motivation|Background|동기)` pattern (mdschema)

Kiro and spec-kit do NOT do schema-based section validation — they control at generation time.

Sources:
- MD043 required headings: https://github.com/DavidAnson/markdownlint/blob/main/doc/md043.md
- mdschema: https://github.com/jackchuka/mdschema
- Structured MADR: https://github.com/zircote/structured-madr
- remark-lint custom rules: https://github.com/remarkjs/remark-lint/blob/main/doc/create-a-custom-rule.md
- Kiro specs: https://kiro.dev/docs/specs/feature-specs/
- Martin Fowler SDD tools: https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html

**Decision:** Use generation control (SKILL.md instructs exact headings) + case-insensitive matching.

---

## 2. Section Content Quality Validation

**Problem:** Section exists but contains only "TBD" or one vague sentence.

**Finding:** 3-layer validation model:

| Layer | What | How | Priority |
|-------|------|-----|----------|
| L1 Structural | TBD/TODO, empty sections, <1 sentence | Regex | Immediate |
| L2 Lexical | Ambiguous terms ("some", "etc.", "as needed") | INCOSE R7/R8 blacklist | Immediate |
| L3 Semantic | Measurability, verifiability | LLM judgment | Deferred |

Key references:
- GitHub TODOCS: CI fails if placeholder found
  - https://docs.github.com/en/enterprise-cloud@latest/contributing/collaborating-on-github-docs/using-the-todocs-placeholder-to-leave-notes
- INCOSE 42 Rules: R7 vague terms, R8 escape clauses, R9 open-ended
  - https://reqi.io/articles/incose-requirements-quality-42-rule-guide
  - https://www.incose.org/docs/default-source/working-groups/requirements-wg/guidetowritingrequirements/incose_rwg_gtwr_v4_summary_sheet.pdf
- NASA TBD policy: must have removal plan + owner
  - https://www.nasa.gov/reference/appendix-c-how-to-write-a-good-requirement/
- Requirements smell detection (89% precision): https://arxiv.org/html/2305.07097
- GitHub spec-kit quality checklist: https://github.com/github/spec-kit/blob/main/templates/commands/checklist.md
- Spec as Quality Gate paper: https://arxiv.org/html/2603.25773

---

## 3. Six Sections Sufficiency — NOT SUFFICIENT

**Problem:** Are 6 sections (motivation, scope, scenario, rule, criteria, decision) enough for all domains?

**Finding:** Two critical gaps across 4+ domains:

### Gap 1: External Constraints (separate from internal rules)
- Medical: IEC 62304 risk classification, FDA regulatory pathway
- Financial: PCI DSS, SOX, AML/KYC compliance
- Government: Accessibility laws (WCAG), language access (Title VI)
- Open source: Backwards compatibility guarantees
- Key distinction: rule = "we decided this", constraint = "externally imposed, cannot change"

### Gap 2: Risk / Failure Analysis
- Medical: Hazard analysis (ISO 14971), patient safety
- Financial: Incident response, audit trail
- AI/ML: Model limitations, failure modes, bias assessment
- Open source: Unresolved questions, known limitations

### Domain-specific gaps (not universal):
- Games: Creative direction, narrative, monetization
- AI/ML: Data requirements, explainability, monitoring
- Government: Equity, multilingual support

**Decision:** Add 2 universal sections → 8 total:
motivation, scope, scenario, rule, **constraint**, **risk**, criteria, decision

Domain-specific sections handled as optional extensions.

Sources:
- Rust RFC template: https://github.com/rust-lang/rfcs/blob/master/0000-template.md
- PEP 1: https://peps.python.org/pep-0001/
- Go proposal template: https://github.com/golang/proposal/blob/master/design/TEMPLATE.md
- IEC 62304: https://www.ketryx.com/blog/a-comprehensive-guide-to-iec-62304-navigating-the-standard-for-medical-device-software
- PCI DSS fintech: https://sprinto.com/blog/pci-dss-for-fintech/
- GDD template: https://www.nuclino.com/articles/game-design-document-template
- Model cards: https://arxiv.org/abs/1810.03993
- UK GDS: https://www.gov.uk/service-manual/service-standard

---

## 4. Brief Splitting Criteria

**Problem:** When and how to split one brief into multiple cards?

### WHEN to split:
- Different Ubiquitous Language used within same card (DDD boundary)
- Multiple teams/services involved
- Cannot complete in one implementation cycle
- Size exceeds Amazon 6-pager / Google 10-20 page guideline

### HOW to split:
- **Vertical Slice first** — split by feature, not by layer
- **SPIDR pattern** — Spike/Paths/Interfaces/Data/Rules
- Original becomes parent, splits become children

Sources:
- Amazon 6-pager: https://writingcooperative.com/the-anatomy-of-an-amazon-6-pager-fc79f31a41c9
- Google Design Doc: https://www.industrialempathy.com/posts/design-docs-at-google/
- DDD Bounded Context: https://martinfowler.com/bliki/BoundedContext.html
- SPIDR: https://www.mountaingoatsoftware.com/blog/five-simple-but-powerful-ways-to-split-user-stories
- Vertical slice: https://www.jimmybogard.com/vertical-slice-architecture/
- SAFe features: https://framework.scaledagile.com/features-and-capabilities
- Atlassian epics: https://www.atlassian.com/agile/project-management/epics

---

## 5. Multi-Brief Relationships

**Problem:** How to manage dependencies and conflicts between multiple briefs?

### Traceability:
- Vertical (parent→child) + Horizontal (sibling) trace links
- Link types: Implements, Tests, Depends-on, Conflicts-with
- RTM (Requirements Traceability Matrix) as standard tool

### Conflict Detection:
- ALICE (Formal Logic + LLM hybrid): 99% precision, 60% recall on real project
- Clustering + Rule-Based: 97% computation time reduction
- NLP/BERT-based: semantic tuple comparison

### Cross-cutting:
- Define centrally, reference from each feature (GovStack pattern)
- Emberdeck glossary already uses this pattern

Sources:
- RTM: https://www.testrail.com/blog/requirements-traceability-matrix/
- ALICE: https://link.springer.com/article/10.1007/s10515-024-00452-x
- Conflict detection clustering: https://ieeexplore.ieee.org/document/10759654/
- GovStack cross-cutting: https://specs.govstack.global/overview/1.0/security-requirements/5-cross-cutting-requirements
- SAFe PI planning: https://framework.scaledagile.com/epic/

---

## 6. Brief-to-Spec-to-Code Traceability

**Problem:** When brief changes, how to track impact on specs and code?

### Methods:
- Bidirectional traceability (forward: req→code, backward: code→req)
- Change propagation via graph BFS
- Auto-flag connected artifacts when source changes (IBM DOORS pattern)

### Emberdeck already has:
- `get_relation_graph` — BFS traversal
- `check_drift` — code link validation
- `pre_change_check` — impact analysis before code changes

### What's needed:
- Brief body change detection → connected spec cards flagged as potentially stale
- Integration with existing drift detection mechanism

Sources:
- IEEE 830 traceability: https://standards.ieee.org/ieee/830/1222/
- IBM DOORS traceability: https://www.ibm.com/docs/en/engineering-lifecycle-management-suite/doors-next/7.0.3?topic=requirements-traceability
- Change impact analysis: https://www.jamasoftware.com/blog/change-impact-analysis/
- Ripple effect: https://ieeexplore.ieee.org/document/4777272/
- Metamodel approach: https://www.sciencedirect.com/science/article/abs/pii/S0950584914000615
- Kiro spec validator: https://kiro.dev/docs/specs/
