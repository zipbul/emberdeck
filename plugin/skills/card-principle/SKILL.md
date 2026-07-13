---
name: card-principle
description: emberdeck principle 카드를 만들거나 수정·검증할 때 따르는 판단 — 여러 결정을 가로질러 스스로에게 지우는, 검증으로 강제되는 규범(정책). 공통 절차는 card-agent 규율을 함께 따른다.
---

# principle 카드 판단

principle은 root다 — 부모·자식 없음. 코드에 바인딩하지 않는다.

## principle이란
프로젝트의 모든 결정이 가로질러 지켜야 하도록 스스로에게 세운 규범(정책)이다. 다른 tier가 지식을 표현한다면, principle만 지식을 강제한다.
- **vision과의 구별** — vision은 범위 없는 종착 방향, principle은 범위를 정해 규범을 부과한다. 강제 유무가 아니라 **범위·규범성**으로 갈린다.
- **brief.policy와의 구별** — 둘 다 MUST/SHALL를 쓰지만 brief.policy는 그 brief 한 장에 국한되고, principle은 여러 카드를 가로지른다.

## 판단
- **범위(applies_to)를 정한다** — 누가 이 규범을 지켜야 하는지. 이게 principle을 교차관심으로 만든다.
- **verify를 밝힌다(hollow 금지).** 위반을 무엇으로 잡는지(verify)를 안 밝히면 거부된다 — 규범처럼 보이되 위반을 잡을 길 없는 빈 원칙이다.
- **verify.class는 정직하게 고른다.** 실제 잡히는 방식으로 — 자동 판정되는 걸 사람 검토로 도피하지도, 안 잡히는 걸 자동인 척 위장하지도 마라. 기계적 enum·형식 제약은 CLI가 잡는다.
- **verify ≠ enforcement.** verify는 '무엇이 위반인가', enforcement는 '얼마나 세게 막나'(별개 축)다. 강제가 약해도(advisory) 유효한 원칙이며, hollow는 강제가 약한 게 아니라 verify를 안 밝힌 것이다.
