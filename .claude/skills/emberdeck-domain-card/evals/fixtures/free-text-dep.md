---
key: billing
summary: 빌링 도메인
status: draft
type: domain
domain:
  overview: 구독 결제 청구와 정산 주기를 다루는 주제영역.
  scope: 'IN: 청구서 생성, 정산 주기 관리. OUT: 알림 발송(notification 도메인).'
  cross_domain_dependencies:
    - domain: notification
      relationship: 이벤트를 구독한다
---

## Notes

relationship이 자유 텍스트라 relationship-free-text에 걸리는 상태.
