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
  enforcement: blocking
  verify:
    class: structural
    structural:
      kind: forbids-relation-to
      targetGlob: notification/**
---

## Notes

현재 활성 원칙.
