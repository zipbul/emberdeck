---
key: card-model
summary: 카드가 무엇인지 정의하는 5-tier 모델 — vision·principle·domain·brief·spec의 필드·상태·위계 규칙
status: draft
type: domain
domain:
  overview: >-
    카드란 무엇인가를 정의하는 의미 단위다. vision·principle·domain·brief·spec 5-tier 각각이 담는 필드와
    그 의미(예: principle의 statement/rationale/applies_to/enforcement/verify, brief의
    context/scope/flow/policy/criteria/rationale, spec의
    preconditions/postconditions/invariants/failures), 카드의
    상태(draft/active/drifted) 전이, tier 간 부모-자식 위계(vision·principle·domain은 root이고
    brief의 부모는 반드시 domain, spec의 부모는 반드시 brief 또는 spec)를 규정한다. 이 정의가 있어야 다른 모든
    도메인이 "카드"라는 대상을 다룰 수 있다.
  scope: >-
    IN — 5-tier 각각의 필드 스키마와 의미, 상태 전이 규칙과 각 tier가 active가 되기 위한 자기 완결적 조건(카드 자신의
    필드만으로 판단 가능한 조건), tier 간 부모-자식 타입 위계의 정의, 카드 키 형식, 카드 자신의 본문 안에서 완결되는 ID
    교차참조(예: brief 안에서 flow.covers가 같은 카드의 scope.goals를 가리키는지, spec의 derives 표기
    형식 자체)의 규칙.

    OUT — 어떤 카드의 부모·relations·cross_domain_dependencies가 실제로 다른 카드에 존재하고 그 타입이
    맞는지 조회해 판정하는 일과 덱 전체를 훑어 위반 사례를 찾아내는 일(둘 다 deck-integrity 소관), 카드가 디스크·DB에
    저장·색인되는 방식(deck-index 소관), spec 카드가 실제 소스 코드와 결합되는 방식(code-binding 소관), 용어집
    항목 자체의 관리(glossary 소관), 이 정의를 조작하는 명령 인터페이스(operator-interface 소관).
---
