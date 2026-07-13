---
key: glossary
summary: 덱이 공유하는 용어 사전(단어-정의)의 등록·조회·매칭을 다루는 도메인
status: draft
type: domain
domain:
  overview: >-
    덱 전체가 공유하는 용어(단어-정의) 사전을 다루는 의미 단위다. 용어 항목의 정의·등록·조회·이름변경·삭제, 용어집
    파일(glossary.yaml)의 저장 형식, 텍스트 안에서 등록된 용어를 찾아내는 매칭을 아우른다.
  scope: >-
    IN — 용어 항목(word/definition)의 등록·조회·수정·삭제와 그 한도, 용어집 파일의 저장·파싱 형식, 카드 본문
    텍스트에서 등록된 용어를 탐지하는 매처.

    OUT — 어떤 카드가 선언한 용어가 실제 용어집과 일치하는지, 또는 정의된 용어가 어떤 카드에서도 쓰이지 않는지 대조하는
    일(deck-integrity 소관 — glossary는 사전 자체만 책임진다), 카드 프런트매터의 glossary 필드가 무엇을
    의미하는지(card-model 소관), 용어집을 조작하는 명령 인터페이스(operator-interface 소관).
---
