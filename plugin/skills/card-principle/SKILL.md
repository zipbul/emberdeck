---
name: card-principle
description: emberdeck principle 카드를 만들거나 수정·검증할 때 따르는 판단 — 프로젝트가 스스로에게 지우는 정책·규칙. 공통 절차는 card-agent 규율을 함께 따른다.
---

# principle 카드 판단

## principle이란
프로젝트가 스스로에게 지우는 규칙 — 여러 결정을 가로질러 지켜야 하는 정책. root(부모 없음).

## 판단
- **강제 방식을 실질적으로 선언한다(hollow principle 금지).** 원칙은 *어떻게 강제되는지*(verify)를 밝혀야 한다 — 안 밝히면 governance처럼 보이되 아무것도 강제 못 하는 빈 원칙이 된다.
- **verify.class는 정직하게 고른다.** 실제 강제되는 방식을 택한다: structural·binding(평가 엔진이 있어 자동 강제) / metric·prose(측정·사람 검토). 강제되지 않는 걸 되는 척(예: prose를 structural로) 위장하지 말고, 검증 가능한 걸 prose로 도피하지도 마라. 기계적 enum·형식 제약은 CLI가 잡으니 너는 **class 선택의 정직성**만 책임진다.
