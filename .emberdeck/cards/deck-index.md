---
key: deck-index
summary: 카드 파일과 SQLite 색인 사이의 저장·동기화·조회를 다루는 도메인
status: draft
type: domain
domain:
  overview: >-
    카드가 디스크 위 .md 파일이라는 source of truth와, 빠른 조회를 위한 SQLite
    색인(카드·태그·관계·전문검색·변경이력·시스템 메타데이터) 사이에서 어떻게 저장·동기화·조회되는지를 다루는 의미 단위다. 디스크→DB
    동기화, 색인 스키마, 검색·조회 연산과 함께, 디스크와 색인이 서로 어긋나지 않았는지(orphan file·stale row·key
    mismatch·content mismatch) 자체의 저장 계층 정합성을 포함한다.
  scope: >-
    IN — 카드 파일의 디스크 저장 경로·형식 규칙, 디스크→DB 동기화(sync-in/export),
    카드·태그·관계·전문검색(FTS)·변경이력·시스템 메타데이터의 색인 스키마, 카드 조회·검색 연산, 디스크 파일과 색인 행 사이의 자기
    정합성(orphan file/stale row/key mismatch/content mismatch) 탐지.

    OUT — 색인되는 필드가 무엇을 의미하는지(card-model 소관), 색인된 데이터를 근거로 카드들 사이의 의미적 정합성(끊긴
    참조·principle 위반 등)을 판정하는 일(deck-integrity 소관), 코드 결합 증거(code_link) 자체가 무엇을
    뜻하는지(code-binding 소관 — deck-index는 그 행을 저장하는 그릇일 뿐), 이 저장소를 조작하는 명령
    인터페이스(operator-interface 소관).
  cross_domain_dependencies:
    - domain: card-model
      relationship: consumes
      note: 카드 필드·tier 스키마를 알아야 행을 저장·색인할 수 있다
---
