---
key: validation
summary: 덱 무결성 검증 도메인
status: active
type: domain
domain:
  overview: >-
    emberdeck 덱의 무결성 검증을 다루는 주제영역. 카드 파일이 단일 진실(SoT)이고 DB 인덱스는 파생물이라는 전제 위에서,
    파일과 인덱스의 정합·계층·비초안 바디 무결성·활성 원칙 강제를 판정하는 규칙과 그 판정의 exit 규약을 정한다.
  scope: >-
    IN: validate cards가 무엇을 어떤 엄격도로 검사하는지 — 파일↔인덱스 재조정, 계층/그래프, 비초안 바디 활성화 동등
    검사, blocking 원칙 강제, 게이트 정책과 verbosity 불변 exit 규약, 무변조 원칙. OUT: 소스 심볼 해석과
    @spec 주석↔캐시 대조(validate links 소관), 소스 드리프트·구조 스멜(check/analyze 소관), 카드 쓰기
    경로의 입력 검증(card create/update 소관).
---
