# Research: Planning Document Structure — Verified Facts

Date: 2026-04-06

## Summary
Investigation into whether planning documents are single or multiple, whether "planning → spec → code" is the correct hierarchy, and what the actual structural relationship between planning elements is.

---

## Finding 1: Planning documents are always multiple for non-trivial services

- Google Design Doc starts as one document but splits into amendments over time
  - Source: https://www.industrialempathy.com/posts/design-docs-at-google/
- Large projects can require hundreds of documents
  - Source: https://www.projectmanager.com/blog/great-project-documentation
- Even Amazon's 6-pager coexists with PR/FAQ and other documents
  - Source: https://writingcooperative.com/the-anatomy-of-an-amazon-6-pager-fc79f31a41c9
- MVP SRS is typically 8-12 pages minimum
  - Source: https://www.zartis.com/how-to-create-a-product-specification-document-for-mvp-development/

## Finding 2: "Planning → Spec → Code" is an oversimplification

- IEEE 29148 defines 4 levels: Business Req → Stakeholder Req → System Req → Software Req
  - Source: https://www.reqview.com/doc/iso-iec-ieee-29148-templates/
- V-model has multiple decomposition stages, not just 2
  - Source: https://en.wikipedia.org/wiki/V-model_(software_development)
- Specs can exist without planning docs (IETF RFCs, OpenAPI specs, open source)
  - Source: https://newsletter.pragmaticengineer.com/p/software-engineering-rfc-and-design
- Planning docs can exist without specs (early startups, MVPs)
  - Source: https://www.ycombinator.com/library/6f-how-to-plan-an-mvp

## Finding 3: Planning elements form a GRAPH, not a tree

- "A singular requirement does not convey the entire story" — requirements form networks
  - Source: https://www.inderscience.com/info/inarticle.php?artid=50130
- ~20% of requirements cause 75% of interdependencies
  - Source: https://link.springer.com/chapter/10.1007/3-540-28244-0_5
- Dependency types: Contractual, Continuance, Compliance, Cooperation, Consequential
  - Source: https://www.researchgate.net/publication/267807462
- NFR Softgoal Interdependency Graph — tradeoffs and synergies captured as graph
  - Source: https://link.springer.com/content/pdf/10.1007%2F978-1-4615-5269-7.pdf
- Same-level requirements can have parent-child relationships (not just cross-level)
  - Source: https://www.valispace.com/how-to-break-down-requirements/

## Finding 4: Real projects use hierarchy + cross-references + central repository

- SAFe: Theme → Epic → Capability/Feature → Story, but planning and execution hierarchies are separate
  - Source: https://framework.scaledagile.com/epic/
  - Source: https://www.enov8.com/blog/the-hierarchy-of-safe-scaled-agile-framework-explained/
- Jira: Epic → Story → Sub-task + Issue Links for cross-references beyond tree
  - Source: https://www.atlassian.com/agile/project-management/epics-stories-themes
- Enterprise Architecture: graph-based repository, not pure document hierarchy
  - Source: https://www.ardoq.com/knowledge-hub/enterprise-architecture-repository

## Finding 5: Cross-cutting elements don't fit in trees

- Cross-cutting concerns: "aspects of a program that affect several modules without being encapsulated in any one"
  - Source: https://en.wikipedia.org/wiki/Cross-cutting_concern
- NFRs are almost always cross-cutting
  - Source: https://ieeexplore.ieee.org/document/8744754
- Management strategies: (a) separate technical stories, (b) distribute as acceptance criteria, (c) explicit central list
  - Source: https://www.projectmanagement.com/blog-post/61717/Strategies-for-Implementing-Non-Functional-Requirements
- Best practice for cross-cutting requirements: define centrally, reference from each feature
  - Source: https://specs.govstack.global/1.0/security-requirements/5-cross-cutting-requirements
  - Source: https://link.springer.com/chapter/10.1007/978-3-540-30187-5_9

## Implications for Emberdeck

Current Emberdeck structure:
- parent-child (tree) + relations (untyped graph edges) + glossary (central cross-cutting)

What's needed based on findings:
1. Multiple planning cards (not single root) — already possible
2. Graph structure for planning elements — relations exist but untyped
3. Cross-cutting elements (policies, glossary, NFRs) managed centrally — glossary exists, policies don't
4. Flexible planning↔spec relationship (not always hierarchical) — currently spec must be under intent
5. Completeness validation — doesn't exist

Key gap: cross-cutting element management and flexible planning↔spec relationships
