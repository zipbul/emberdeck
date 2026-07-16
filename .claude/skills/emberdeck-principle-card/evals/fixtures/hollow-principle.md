---
key: no-payment-notif-coupling
summary: payment must not couple to notification
status: active
type: principle
principle:
  statement: Payment code MUST NOT depend on the notification domain.
  rationale: Coupling payment to notification exposes payment integrity to notification outages.
  applies_to:
    - payment/**
  enforcement: warning
  verify:
    class: prose
---

## Notes

경계 규칙인데 verify가 prose라 엔진이 강제하지 못하는 상태(hollow).
