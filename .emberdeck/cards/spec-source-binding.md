---
key: spec-source-binding
summary: draft가 아닌 spec 카드는 소스의 @spec 주석으로 코드에 바인딩되어야 한다
status: active
type: principle
principle:
  statement: >-
    draft가 아닌(active·drifted) 모든 spec 카드는 소스 코드의 @spec <card-key> 주석으로 바인딩되어야
    하며(MUST), spec sync가 수집한 code_link 증거가 카드당 1건 이상 존재해야 한다.
  rationale: >-
    spec은 5-tier 중 유일하게 코드와 연결되는 카드다. 바인딩 없는 spec은 어떤 코드가 그 기준을 구현하는지 가리킬 수 없어
    검증 불가능한 문서로 남고, 카드에서 코드를 재생성한다는 emberdeck의 전제가 그 지점에서 끊어진다.
  applies_to: '*'
  enforcement: blocking
  verify:
    class: binding
---
