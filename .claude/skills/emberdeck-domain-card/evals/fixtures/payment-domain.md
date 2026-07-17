---
key: payment
summary: 결제 도메인
status: draft
type: domain
domain:
  overview: 결제 승인·정산·환불을 다루는 주제영역.
  scope: 'IN: 승인, 정산, 환불, 결제수단 관리. OUT: 알림 발송(notification 도메인), 회원 관리(member).'
  cross_domain_dependencies:
    - domain: notification
      relationship: invokes
      note: 결제 완료 알림 발송을 호출
---

## Notes

정상 도메인 seed.
