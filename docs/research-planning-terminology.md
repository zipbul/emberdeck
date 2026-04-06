# Research: Planning Document Terminology — 기획 / 기획서 English Equivalent

Date: 2026-04-06

## Summary
Investigation into the correct English term for Korean "기획" (the act of conceiving/defining WHAT to build and WHY) and "기획서" (the document). Concluded that no 1:1 equivalent exists. "Conception" was initially proposed but rejected after verification. "Brief" was selected as the Emberdeck system term.

## Finding 1: No 1:1 English equivalent for 기획

- Korean "기획" covers conception + definition + scoping in a single concept
- English distributes this across: Discovery, Definition, Specification
- Korean tech companies translate 기획자 differently: Naver="Service Planner", Kakao="Platform & Service Planning", Samsung="Product Planning"
- "Product Planner" is a Korean-specific job title, rarely used globally
- Source: https://soyoungsong.medium.com/what-is-role-of-기획자-planner-in-korea-tech-scene-2e013179137b

## Finding 2: "Conception" is unsuitable

- English native speakers associate "conception" with pregnancy first (WordReference forum)
- No major product development framework uses "conception" as a phase name
- SDLC uses "Conceptualization", RUP uses "Inception" — not "Conception"
- "Product conception" would not be immediately understood by English-speaking PMs/engineers
- Sources:
  - https://forum.wordreference.com/threads/concept-vs-conception.19344/
  - https://en.wikipedia.org/wiki/Systems_development_life_cycle
  - https://en.wikipedia.org/wiki/Unified_process

## Finding 3: Verified alternative terms

| Term | Usage Frequency | Match to 기획 | Context |
|------|----------------|---------------|---------|
| Product Discovery | Very high (Marty Cagan, NN/g) | Medium | Includes user research/validation, broader than 기획 |
| Product Definition | High (Asana 6-stage model) | High | "Defining requirements and specs" — closest to WHAT/WHY |
| Concept Development | High (NPD/BAH model standard) | High | Developing ideas into concrete concepts |
| Ideation | Very high | Low | Only idea generation, narrower than 기획 |
| Inception | Medium (RUP only) | Medium | RUP-specific, not general |
| Product Brief | High (document name) | High | "Key summary document for decision-making" |

Sources:
- https://asana.com/resources/product-development-process
- https://en.wikipedia.org/wiki/New_product_development
- https://www.nngroup.com/articles/discovery-phase/
- https://www.zigngroup.com/insights/the-importance-of-the-definition-phase-in-product-development
- https://www.productplan.com/glossary/product-brief/

## Finding 4: Korean IT planning document (기획서) practice

- Standard structure: 서비스 개요 → 서비스 구성(IA, policies, processes) → 상세 기획(wireframes, specs)
- Framework: Why → What → How → So What (3W 1H)
- Version management: v0.7 (author complete) → v0.8 (kickoff feedback) → v0.9 → v1.0 (final) → v1.1+
- Sources:
  - https://brunch.co.kr/@ecobyun/3
  - https://brunch.co.kr/@ecobyun/6
  - https://www.mobiinside.co.kr/2022/03/31/service-plan/

## Decision: Use "brief" as Emberdeck system term

Reasons:
1. Emberdeck deals with the DOCUMENT (기획서), not the activity — so a document-oriented term is appropriate
2. "Product brief" is an established industry term meaning "key summary document for decision-making"
3. Short, single word — good for code/API naming
4. Clearly distinct from "spec" (which Emberdeck already uses)
5. No ambiguity or unwanted associations

System naming:
- Template file: `brief-template.yaml`
- Validation tool: `emberdeck_validate_brief`
- Card tags: motivation, scope, scenario, rule, criteria, decision (under brief structure)
