# CLAUDE.md

Claude Code가 이 저장소에서 작업할 때 참고하는 가이드.

## 프로젝트

SSAFY 15기 2학기 **자율 프로젝트**. 주제·서비스 개요는 기획이 확정되면 이 절에 채운다.

JIRA 프로젝트 키는 `S15P31A307`, 원격은 GitLab(`lab.ssafy.com/s15-final/S15P31A307`)이다.

## 저장소 구조

```
AI/       AI · 데이터
BE/       API 서버
EMB/      임베디드
FE/       웹 클라이언트
Infra/    배포 구성
Docs/
  Convention/      팀 규칙 (Git · JIRA)
  Service Design/  기획 문서
```

파트별 기술 스택과 셋업·실행 방법은 각 폴더의 README에 둔다. 작업 전 해당 README를 먼저 읽는다.

## 현재 상태

- **초기 구성 단계다.** 주제·기술 스택·파트 구성이 확정되지 않았으므로, 확정되면 이 절과 위 구조를 갱신한다.
- 파트별 스택이 정해지기 전에 하위 폴더나 설정 파일을 미리 만들지 않는다 — 스캐폴딩 도구가 만드는 구조와 충돌할 수 있다.

## 커밋·브랜치 규칙

**커밋·브랜치를 만들기 전에 항상 [Docs/Convention/Git Convention.md](./Docs/Convention/Git%20Convention.md) 원문을 먼저 읽는다.** 아래는 자주 놓치는 지점만 짚어둔 요약이지 전체 규칙이 아니다 — 이 요약과 원문이 어긋나면 원문이 맞다.

- 커밋: `[<JIRA-KEY>] <type>: <subject>` — `type`은 `feat`/`fix`/`docs`/`style`/`refactor`/`test`/`chore`. JIRA 키는 실제 작업(Task)·버그(Bug) 이슈 키를 쓰고, Story·Epic 키로 대체하지 않는다.
- **티켓이 존재할 수 없는 순수 저장소 설정 작업**(예: 이 문서 자체 정비, 최초 리포 골격 구성)만 키 없이 `chore:`로 쓴다 — 이 예외는 Git Convention 원문에는 없다. 애매하면 사용자에게 티켓 유무를 먼저 확인한다.
- 이슈 구조·제목·레이블·상태·완료 기준은 [Docs/Convention/Jira Convention.md](./Docs/Convention/Jira%20Convention.md)를 따른다.
- 커밋 단위는 Task 단위로 나눈다. 한 커밋에 여러 티켓을 섞으면 JIRA 개발 탭 연결이 뭉개진다.
- 브랜치에는 JIRA 키가 아니라 **관련 Story가 속한 Epic의 prefix**를 쓴다 (`feat/{Epic prefix}-{내용}`, 예: `feat/AUTH-login-api`). 관련 Story가 없는 작업은 공식 업무 분류(`PLAN`, `UX`, `DESIGN`, `TECH`, `INFRA`, `DOCS`, `QA`, `PT`)를 prefix로 쓴다.
- `feat/*`, `fix/*`는 해당 파트 `develop-*`(`develop-FE`/`develop-BE`/`develop-AI`/`develop-EMB`)에서 분기해 그쪽으로 MR을 연다. `main`, `develop-*`에는 직접 커밋·push하지 않는다.
- MR 본문은 `.gitlab/merge_request_templates/Default.md`(원문 3.3절) 형식을 따른다. 병합은 squash 없이 일반 Merge.
- **매주 금요일 정기 릴리즈**(원문 7절). 버전은 `v{주차}.{번호}`로 금요일 정기 릴리즈가 `v{주차}.0`, 그 뒤 추가 릴리즈가 `.1`, `.2`…. Git 태그·GitLab Release·Jira 릴리즈 이름을 같게 쓴다. 릴리즈 처리는 팀장이 하며, 코드 변경 Task·Bug에는 Jira `버전`(Fix Version)을 입력한다 (Jira Convention 10장).

## 작업 시 주의

**커밋·푸시는 요청받았을 때만 한다.** 파일 생성·수정 후에는 무엇을 바꿨는지 보고하고 커밋 여부는 사용자 판단에 맡긴다.

**시크릿을 커밋하지 않는다.** `.env`, `*.pem`, `*.key`, API 키, DB 접속 정보, 서버 키페어가 여기 해당한다. `.gitignore`를 만들 때 이 패턴을 반드시 포함한다.

**문서는 한국어로 쓴다.** 코드 주석도 한국어를 쓴다.

**줄바꿈은 LF로 유지한다.** `.gitattributes`를 추가하면 여기서 정규화한다.

**호출 한도·과금이 있는 외부 API는 대량·반복 실행 전 사용자에게 확인한다.** 스크립트 작성은 하되, 실행 범위(기간·건수)를 사용자와 먼저 맞추고 실행한다. 스키마 확인 수준의 1회성 호출은 예외.

**커밋 전 해당 파트의 lint·테스트를 로컬에서 통과시킨다.** 검증 명령은 파트 초기화 후 각 파트 README에 정리한다.
