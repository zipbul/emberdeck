---
key: code-binding
summary: spec 카드와 실제 소스 코드 사이의 결합·드리프트·영향을 다루는 도메인
status: draft
type: domain
domain:
  overview: >-
    spec 카드가 실제 소스 코드와 맺는 대응 관계를 다루는 의미 단위다. `@spec <card-key>` JSDoc 주석이 카드-코드
    결합의 유일한 메커니즘이며, 그 결합의 증거(코드 심볼의 kind·file·symbol), 결합이 실제 코드에서 여전히
    해소되는지(resolve)와 코드가 spec과 어긋났는지(drift), 카드가 코드를 얼마나 커버하는지(coverage)와 미커버 영역,
    소스 변경이 어떤 카드에 영향을 주는지(impact)와 회귀 여부(regression), 카드들이 코드 심볼을 공유하며
    상호작용하는지(interactions)를 아우른다.
  scope: >-
    IN — @spec 주석 문법과 그로부터 추출되는 결합 증거, 소스 심볼 재색인과 결합의 해소·소실(drift) 판정, spec 자신의
    활성화가 자신의 결합 증거 해소 여부에 달려 있다는 규칙, 코드 커버리지·미커버 심볼 탐지·카드 스코프 제안, 소스 변경의 사전 영향
    분석과 회귀 가드, 카드 간 코드 심볼 상호작용 분석.

    OUT — 이 결합 증거가 어느 저장소에 어떻게 영속·질의되는지의 저장 메커니즘(deck-index 소관 — code-binding은 그
    저장소를 호출해 쓸 뿐), spec 카드 자신의 필드 스키마 의미와 오직 spec만 코드에 결합한다는 tier 규정(card-model
    소관), principle이 여러 spec에 걸쳐 결합 증거의 존재를 강제하는 거버넌스(deck-integrity 소관 —
    code-binding은 증거만 제공한다), 이 기능을 호출하는 명령 인터페이스(operator-interface 소관).
  cross_domain_dependencies:
    - domain: card-model
      relationship: consumes
      note: spec만 코드와 결합한다는 tier 규정을 전제한다
    - domain: deck-index
      relationship: invokes
      note: 결합 증거(code_link)를 영속·질의하기 위해 색인 저장소를 호출한다
---
