---
key: spec-source-binding
summary: 모든 active spec은 @spec으로 소스에 바인딩되어야 한다
status: active
type: principle
principle:
  statement: >-
    모든 active spec 카드는 소스 코드에 @spec 주석으로 바인딩되어야 한다(MUST). @spec은 카드와 코드를 잇는 유일한
    바인딩 메커니즘이다.
  rationale: >-
    카드가 source of truth로 성립하려면 코드와 검증 가능하게 묶여야 한다. 바인딩 없는 spec은 코드를 대변한다고 주장하지만
    실제로는 어긋나 거짓말하는 문서가 된다 — 그 결합을 증거(@spec code link)로 강제해야 카드에서 코드를 재생성한다는 명제가
    지켜진다.
  applies_to: '*'
  enforcement: blocking
  verify:
    class: binding
---
