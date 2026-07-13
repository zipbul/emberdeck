---
key: operator-interface
summary: 조작자(사람·AI 에이전트)가 명령으로 덱과 상호작용하는 경계를 다루는 도메인
status: draft
type: domain
domain:
  overview: >-
    사람 또는 AI 에이전트인 조작자가 명령을 통해 덱과 상호작용하는 경계를 다루는 의미 단위다. 명령·인자·플래그의 구조,
    stdout/stderr 출력 계약, 종료 코드 어휘, 파괴적 조작에 대한 확인 절차를 아우른다. 다른 모든 도메인의 연산은 이 경계를
    통해서만 조작자에게 노출된다.
  scope: >-
    IN — 명령 이름·인자·플래그 구조와 어느 하위 연산으로 라우팅되는지, stdout(명령 결과
    JSON)·stderr(JSON-lines: level/code/message) 출력 계약과 quiet/verbose 모드, 종료 코드
    체계, 파괴적 조작(삭제·리셋 등) 확인 절차.

    OUT — 각 명령이 호출하는 연산 자체의 의미 — 카드 정의(card-model), 저장·조회(deck-index), 코드
    결합(code-binding), 정합성 검증(deck-integrity), 용어집(glossary) — 는 각각 그 도메인 소관이며,
    operator-interface는 그 연산들을 조작자에게 노출하는 경계만 책임진다.
  cross_domain_dependencies:
    - domain: card-model
      relationship: invokes
      note: card schema/create/update 등 명령이 카드 정의 연산을 직접 호출한다
    - domain: deck-index
      relationship: invokes
      note: card list/search/get 등 명령이 색인 조회 연산을 직접 호출한다
    - domain: code-binding
      relationship: invokes
      note: spec annotate/sync, check drift/coverage/impact 등 명령이 코드 결합 연산을 직접 호출한다
    - domain: deck-integrity
      relationship: invokes
      note: validate cards/links 명령이 정합성 검증 연산을 직접 호출한다
    - domain: glossary
      relationship: invokes
      note: glossary define/lookup/remove/rename 명령이 용어집 연산을 직접 호출한다
---
