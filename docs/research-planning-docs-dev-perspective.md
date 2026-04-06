# Research: Planning Documents — Development Perspective

Date: 2026-04-06

## Summary
Cross-analysis of IEEE SRS, Google Design Doc, Rust/Go/Python RFCs, ADR, PRD, and SDD tools to identify universal required elements in software planning documents.

## 1. Industry Standard Formats

### IEEE 830 / ISO/IEC/IEEE 29148
- Software Requirements Specification standard
- Sections: Introduction (purpose, scope, definitions), Overall Description (product perspective, user characteristics, constraints), Specific Requirements (functional, non-functional, interfaces, performance)
- 8 quality characteristics: correct, unambiguous, complete, consistent, ranked, verifiable, modifiable, traceable
- Sources:
  - https://ieeexplore.ieee.org/document/720574
  - https://www.reqview.com/doc/iso-iec-ieee-29148-templates/
  - https://tms-outsource.com/blog/posts/what-is-ieee-830-in-software-development/

### Google Design Doc
- Sections: Context and Scope, Goals and Non-Goals, The Actual Design, Alternatives Considered, Cross-Cutting Concerns
- "Informal documents created before coding that document the high level implementation strategy and key design decisions with emphasis on trade-offs"
- Source: https://www.industrialempathy.com/posts/design-docs-at-google/

### RFC Formats (Open Source)

**Rust RFC**: Summary, Motivation, Detailed Design, Alternatives, Unresolved Questions
- Source: https://rust-lang.github.io/rfcs/0002-rfc-process.html

**Go Proposal**: Abstract, Background, Proposal, Rationale, Compatibility, Implementation, Open Issues
- Source: https://github.com/golang/proposal/blob/master/design/TEMPLATE.md

**Python PEP**: Abstract, Motivation, Specification, Rationale, Backwards Compatibility, Security, How to Teach This, Rejected Ideas
- Sources: https://peps.python.org/pep-0012/ , https://peps.python.org/pep-0001/

**HashiCorp RFC**: Overview, Background, Proposal/Goal, Abandoned Ideas, Implementation, UX/UI
- Source: https://www.hashicorp.com/en/how-hashicorp-works/articles/rfc-template

**TC39**: 6-stage maturity process (Stage 0-4)
- Source: https://tc39.es/process-document/

100+ organizations use RFC/Design Doc processes.
- Source: https://blog.pragmaticengineer.com/rfcs-and-design-docs/

### ADR (Architecture Decision Record)
- Minimum structure: Context, Decision, Consequences
- MADR format widely used
- Sources:
  - https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
  - https://adr.github.io/madr/
  - https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html

### PRD (Product Requirements Document)
- Sections: Project overview, Goals/Success Metrics, User Personas, Requirements, Out-of-scope, Assumptions
- Sources:
  - https://www.atlassian.com/agile/product-management/requirements
  - https://productschool.com/blog/product-strategy/product-template-requirements-document-prd

## 2. Universal Required Elements (Cross-format Analysis)

| Element | IEEE SRS | Google Design Doc | RFC | ADR | PRD |
|---------|---------|-------------------|-----|-----|-----|
| Motivation/Problem (Why) | Purpose, Scope | Context | Motivation | Context | Problem statement |
| Glossary/Domain Language | Definitions | (implicit) | (implicit) | (implicit) | (implicit) |
| Goals & Non-Goals | Scope | Goals/Non-Goals | Summary | Decision | Goals/OOS |
| Detailed Spec (What/How) | Specific Reqs | The Design | Detailed Design | Decision | Features |
| Constraints/Rules | Constraints | Cross-cutting | Compatibility | Consequences | Assumptions |
| Alternatives/Tradeoffs | (none) | Alternatives | Alternatives | (none) | (none) |
| Unresolved Questions | (none) | (none) | Open Issues | (none) | (none) |

## 3. Business Rules Documentation
- Should be declarative: "Subject + Verb + Object" single statements
- Each rule gets unique identifier (BR#)
- Must be independent of process/workflow
- Source: https://medium.com/analysts-corner/identifying-and-documenting-business-rules-6e93978b1671
- Source: https://www.quickbase.com/blog/define-business-rules-before-documenting-requirements-for-the-best-outcome

## 4. Domain Glossary / Ubiquitous Language
- DDD core concept by Eric Evans
- "The practice of building up a common, rigorous language between developers and users" — Martin Fowler
- Source: https://martinfowler.com/bliki/UbiquitousLanguage.html
- Source: https://agilealliance.org/glossary/ubiquitous-language/

## 5. Evidence: Planning Improves Outcomes

### NASA Error Cost Escalation
- Requirements phase: 1x, Operations phase: 29-1,500x
- Source: https://ntrs.nasa.gov/api/citations/20100036670/downloads/20100036670.pdf

### Standish Group CHAOS Report
- 24% of failed projects cite unclear requirements as primary cause
- Top 3 success factors: user involvement, executive support, clear requirements
- Source: https://www.infoq.com/articles/standish-chaos-2015/

### Requirements Traceability
- More complete traceability significantly reduces defect rates
- Source: https://www.researchgate.net/publication/309523115

## 6. Vibe Coding and Planning Documents

### Addy Osmani's Distinction
- Vibe Coding: high-level prompts, accept AI suggestions, minimal review
- AI-Assisted Engineering: includes design docs, code review, TDD
- Source: https://medium.com/@addyosmani/vibe-coding-is-not-the-same-as-ai-assisted-engineering-3f81088d5b98

### SDD Tools (2025+)
- Kiro (AWS): Requirements → Design → Tasks, EARS notation
- GitHub spec-kit: Constitution → Specify → Plan → Tasks
- Tessl: Spec-anchored to spec-as-source
- Sources:
  - https://kiro.dev/docs/specs/
  - https://github.com/github/spec-kit/blob/main/spec-driven.md
  - https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices

### Key Gap
No existing SDD tool systematically handles upper-level planning elements (business rules, glossary, policies). They stay at development spec level.
