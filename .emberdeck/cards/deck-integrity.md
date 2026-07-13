---
key: deck-integrity
summary: 카드 간 참조 해소와 principle 시행을 통해 덱 전체의 정합성을 지키는 도메인
status: draft
type: domain
domain:
  overview: >-
    덱 전체가 스스로 참인 상태를 유지하는지를 다루는 의미 단위다. 개별 카드의 필드가 아니라 카드들 사이의 선언된 관계 — 부모,
    relations, cross_domain_dependencies, spec의 derives/invokes/failures 참조 — 가
    실제 다른 카드에 대해 해소되는지, 그리고 principle 카드가 선언한
    규범(verify.class=structural/binding)이 실제로 지켜지는지를 감시한다. 시행 시점이 카드 작성 순간이든 덱 전체
    스윕이든 관계없이, "카드가 서로에 대해 주장하는 바가 실제로 참인가"라는 하나의 관심사를 다룬다.
  scope: >-
    IN — 카드 간 참조(부모 존재·타입 일치·순환, relations 대상 존재, cross_domain_dependencies 대상
    존재·타입·자기참조·상호결합, spec의 derives/case_of/invokes/failures owner·references 해소,
    SHP id 덱 전역 유일성)를 실제 다른 카드 데이터에 대해 판정하는 일, principle의
    verify.class(structural/binding) 시행 엔진, 덱 전역 위상 규칙(vision 단일성, 빈 트리, active가
    draft에 의존하는 rework-dependency).

    OUT — tier 위계·필드 자체가 무엇을 규정하는지의 정의(card-model 소관 — deck-integrity는 그 규정을 실제
    데이터에 대해 시행할 뿐 정의하지 않는다), 카드가 디스크·DB에 저장·동기화되는 방식 자체(deck-index 소관 —
    deck-integrity는 그 색인을 조회해 쓸 뿐), 코드 결합 증거의 생성·해소·드리프트 판정 메커니즘 자체(code-binding
    소관 — deck-integrity는 증거의 유무만 소비한다), 용어집 항목 자체의 관리(glossary 소관 —
    deck-integrity는 용어의 존재 여부만 대조한다), 이 검증을 호출하는 명령 인터페이스(operator-interface
    소관).
  cross_domain_dependencies:
    - domain: card-model
      relationship: consumes
      note: tier 위계·필드 규정을 전제로 위반을 판정한다
    - domain: deck-index
      relationship: invokes
      note: 덱 전역을 훑기 위해 색인된 카드·관계 행을 조회한다
    - domain: code-binding
      relationship: consumes
      note: binding principle 시행에 code_link 결합 증거의 유무를 사용한다
    - domain: glossary
      relationship: consumes
      note: 카드가 선언한 용어가 실제 용어집에 존재하는지 대조한다
---
