# BE API 서버

## 악보 연습 속도와 연주 기록 (MODE-003)

타격 위치와 리포트 노트 구간은 곡 시각(ms), 타격 오차와 판정 폭은 실제 시간(ms)을 쓴다. 업로드 검증은 곡 시각 차이를 `judgementContext.playbackRate`로 나눈다. 연주 목록과 리포트의 `playbackRate`는 숫자이며 옛 기록은 1이다. 최고 점수·최고 정확도와 추천의 숙련도 기준에는 1배속 기록만 쓰고 최근 연주 시각에는 모든 배율을 포함한다. 내부 약점 분석 요청에도 배율을 전달한다.

## 곡 난이도와 채보 실패 사유 (269번)

`GET /api/v1/songs`와 `GET /api/v1/songs/{songId}`는 곡별 `songLevel`을 제공한다.
값은 `BEGINNER`, `INTERMEDIATE`, `ADVANCED`, 미산정이면 `null`이다. MIDI 업로드의 201 응답에도 같은 상세가 나온다.
기존 `difficulties`의 `EASY` / `NORMAL` / `HARD`는 연습 단계이며 곡 난이도와 별개다.
목록 쿼리 `songLevel`은 세 값 중 하나로 서버 필터링한다. `playableOnly=true`는 READY이면서 곡 난이도가 있는 곡만 반환한다.
`withAccompaniment=true`는 반주 상태가 `READY` 또는 `GENERATING`인 곡만 반환한다. `false` 또는 생략하면 제한하지 않으며 다른 값은 400이다.
이 필터들은 교집합이며 전체 건수와 페이지에 똑같이 적용한다. 생략하면 기존 범위를 유지하므로 내 곡의 처리 중·실패 항목도 볼 수 있다.

본인 곡이 실패했고 최신 채보 작업도 실패한 경우 `chartFailure`에 `{code,message,reason}`이 들어간다. 공개 가능한 기존 코드는
`INPUT_INVALID`, `OUTPUT_INVALID`, `MODEL_FAILED`, `JOB_CANCELLED`, `WORKER_OFFLINE`이고 그 외 또는 코드 없는 실패는 `JOB_FAILED`로 표현한다.
선택 필드 `reason`은 `SOURCE_INVALID`, `NOT_TRANSCRIBABLE`, `GPU_OUT_OF_MEMORY`, `INTERNAL_ERROR` 중 하나이며 기존 행과 BE 자체 실패는 `null`이다. 워커가 보낸 메시지·스토리지 정보는 반환하지 않는다. 재시도 중간 실패는 공개하지 않고 최종 실패의 사유만 저장한다. AI 워커 기본 전송 설정은 꺼져 있으므로 BE 배포 뒤 `SSAPLASH_WORKER_SEND_REASON` 설정과 연동을 확인한다.

### 산정 방식과 한계

`song-level-1`은 선택된 채보의 유효 노트 수를 곡 길이로 나눈 초당 평균과, 2초 반열린 구간의 최대 노트 수를 2로 나눈 초당 피크를 사용한다.
평균이 5 미만 / 5 이상 7 미만 / 7 이상이면 각각 입문 / 중급 / 고급이다. 피크는 6 / 8을 같은 방식으로 나누고 두 결과 중 높은 등급을 쓴다.
동시 노트는 각각 센다. 신규 곡은 최신 HARD 버전이고, V29 적용 시 이미 READY이며 HARD chart 행이 없던 기존 곡은 최고 보유 단계의 최신 버전을 사용한다.
HARD 행이 생기면 HARD로 전환하며 해당 행에 버전이 없거나 최신 버전이 유효하지 않으면 미산정이다. 산정 입력의 버전·규칙·곡 길이를 기록하고 입력 변경 시 재산정한다.

이 경계는 내장 연습곡 3개, 합성 패턴 7개, 소수 노트 MIDI 테스트 fixture로 확인한 MVP 휴리스틱이다. 사용자 체감이나 교육적 난이도를 검증한 값이 아니며
짧은 고밀도 구간이나 동시 타격이 곡 전체 등급을 높일 수 있다. FE와 변경된 경계를 확인해야 한다.

### 기존 곡 backfill

마이그레이션은 기존 데이터를 보존하고 예외 대상을 기록하며 곡 난이도를 자동으로 채우지 않는다. 별도 운영 도구는 `DB_URL`, `DB_USERNAME`,
`DB_PASSWORD`를 환경변수로 받는다. 비밀번호를 명령줄이나 저장소에 적지 않는다. `BE` 디렉터리에서 다음 명령은 읽기 전용 dry-run이다.

```sh
./gradlew --no-daemon backfillSongLevel
```

대상과 결과를 확인한 뒤 적용을 명시하려면 `./gradlew --no-daemon backfillSongLevel --args='--apply'`를 사용한다.
시작 시 ID 상한을 고정하고 100개씩 조회하며 각 곡을 별도 트랜잭션에서 처리한다. 실패한 항목은 ID와 범주만 출력하고 다음 항목으로 진행한다.
재실행은 동일 입력에 멱등이다. 구버전 앱이 쓰기를 마친 뒤 backfill을 실행하고 최신 버전·곡 길이·규칙·기존 예외 정합성을 확인한 후
등급 기반 필터를 사용한다. 구버전이 쓰는 동안에는 결과가 오래될 수 있다. 운영 실행은 실제 데이터에 적용하는 별도 작업이다.

관련 작업: [S15P31A307-93 프로젝트 초기화·앱 컨테이너 실행 정의](https://ssafy.atlassian.net/browse/S15P31A307-93),
[S15P31A307-85 공통 응답·예외 처리·Swagger 설정](https://ssafy.atlassian.net/browse/S15P31A307-85),
[S15P31A307-86 회원·소셜 연동 정보 스키마·마이그레이션](https://ssafy.atlassian.net/browse/S15P31A307-86),
[S15P31A307-87 OAuth 제공자 연동·최초 로그인 시 회원 가입](https://ssafy.atlassian.net/browse/S15P31A307-87)

## 패키지 구조와 의존 방향

기본 패키지 `com.ssafy.airdrum` 아래 `domain`은 auth, user, withdrawal, preset, song, chart, play, report, recording,
recommendation, sheet, lesson, telemetry로 나눈다. 각 도메인은 필요한 역할에 따라 `controller`, `service`, `repository`,
`entity`, `dto`, `model`, `event`, `storage`, `client`, `scheduler` 등을 둔다. 예를 들어 실시간 코칭은
`domain.play.service.livecoach`, 리포트 코칭은 `domain.report.service.narrative`, 채보 워커는 `domain.chart.service.worker`가 담당한다.

`global`은 공통 오류·응답·설정·검증·웹·멀티파트와 워커 인증 같은 공용 기술을 제공한다. 기능별 데이터와 업무 정책은 각 도메인에 둔다.
도메인 간 경계에서는 공개 서비스·입력 계약을 사용한다. 예를 들어 play는 report의 집계 계약을 사용하고, 공통 워커 인증은 특정 작업 큐에 의존하지 않는다.
곡 조회는 chart의 채보 요약 서비스를 사용하고, 플레이 업로드는 user의 회원 잠금 서비스를 사용한다. 곡 공개 범위와 레슨 제외 조건은 도메인 간 SQL 상수로 공유한다.

원자성이 필요한 작업은 서비스 트랜잭션에서 조율한다. 플레이 업로드는 미리 계산한 리포트를 세션·hits와 함께 저장하고 분석 요청은 커밋 후 처리한다.
탈퇴는 회원을 잠근 뒤 각 도메인 삭제와 동의 이력 기록을 같은 트랜잭션에서 수행하며 후속 정리는 커밋 후 이벤트 등으로 처리한다.
테스트는 `src/test/java`에서 관련 도메인·역할과 같은 패키지에 두고 공통 초기화는 `support`에 둔다. 별도 운영 도구는 `src/tools/java`,
TimescaleDB 전용 검사는 `src/timescaleTest/java`에 있다.

## 기술 스택

| 항목 | 버전·구성 |
| --- | --- |
| Java | 21 LTS |
| Spring Boot | 4.1.1 |
| Gradle | 9.8.1, Wrapper 포함, Groovy DSL |
| HTTP | Spring MVC, 내장 Tomcat |
| 상태 확인 | Spring Boot Actuator |
| 입력 검증 | Bean Validation (`spring-boot-starter-validation`) |
| API 문서 | springdoc-openapi 3.1.1 (Swagger UI). Boot 4 전용 3.x 라인이며 2.x는 쓰지 않는다 |
| DB | PostgreSQL 16 + TimescaleDB 2.30.2, JDBC 드라이버 42.7.x |
| 영속성 | Spring Data JPA (Hibernate 7). 스키마는 만들지 않고 검증만 한다(`ddl-auto: validate`) |
| 마이그레이션 | Flyway 12 (`spring-boot-starter-flyway` + `flyway-database-postgresql`) |
| 테스트 DB | 일반 테스트: 임베디드 PostgreSQL 16, V1~V7. V8: 별도 실제 TimescaleDB Docker 검사 |
| 외부 HTTP | `RestClient` (`spring-boot-starter-restclient`). OAuth 제공자 호출. 테스트는 `MockRestServiceServer` |
| 인증 | Spring Security 7.1.1. Bearer 필터는 직접 두고 JWT(HS256) 서명·검증만 `spring-security-oauth2-jose`(Nimbus) |
| 토큰 저장소 | Redis 7 (`spring-boot-starter-data-redis`, Lettuce). refresh 토큰 보관. 테스트는 메모리 구현 |

2026-10-19 초기화 시 공식 Spring Initializr의 안정 버전을 사용했다.
기존 설계 문서의 Boot 3.x에서 4.1.1로 변경했다. Java 21과 Gradle 9.x는
[공식 지원 범위](https://docs.spring.io/spring-boot/4.1/system-requirements.html)에 포함된다.
Boot 4는 Jackson 3 및 Spring Security 7을 기준으로 하므로 후속 기능을 추가할 때
3.x용 예제와 패키지·스타터 이름을 혼용하지 않는다.

기동하려면 TimescaleDB 확장이 설치·preload된 PostgreSQL 16이 필요하다. 기동할 때 Flyway가 마이그레이션을 적용하고
Hibernate가 엔티티와 스키마를 검증한다. 소셜 로그인은 [소셜 로그인](#소셜-로그인)을 따른다.
토큰·인증 규칙과 다른 모듈에서 인증을 쓰는 방법은 [인증과 토큰](#인증과-토큰)을 따른다. AI 연동은 해당 기능 작업에서 추가한다.
공통 응답·오류 형식과 OpenAPI 문서는 아래 [API 규약](#api-규약)을, 스키마 변경은
[DB와 마이그레이션](#db와-마이그레이션)을 따른다.

## 로컬 실행

JDK 21을 설치하고 `JAVA_HOME`을 지정한다. IDE의 Project SDK와 Gradle JVM도 21로 맞춘다.
별도 Gradle 설치는 필요 없다.

로컬 PostgreSQL 16과 Redis 7을 준비한다. Infra Compose의 `postgres`는 내부 네트워크 전용이라
호스트에서 실행한 앱이 붙을 수 없다. Docker를 쓰면 아래처럼 로컬 전용 컨테이너를 띄운다.
설치형 DB에는 동일한 TimescaleDB 확장과 preload 설정이 필요하다. 비밀번호는 각자 정하고 저장소에 남기지 않는다.

```sh
docker run -d --name airdrum-db -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=app -e POSTGRES_DB=app -e POSTGRES_PASSWORD=<로컬 비밀번호> \
  timescale/timescaledb:2.30.2-pg16 \
  postgres -c shared_preload_libraries=timescaledb
# refresh 토큰 저장소. 로컬은 비밀번호 없이 루프백에만 연다.
docker run -d --name airdrum-redis -p 127.0.0.1:6379:6379 redis:7-alpine
```

Redis 없이 띄우려면 `REFRESH_TOKEN_STORE=memory`, `MANAGEMENT_HEALTH_REDIS_ENABLED=false`를 준다.
refresh 토큰이 메모리에만 있어 재시작하면 로그인이 풀린다(기동 시 WARN).

아래 명령은 `BE/`에서 실행한다.

```powershell
# Windows PowerShell: 실제 설치 경로로 지정한다.
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21.0.11'
$env:DB_PASSWORD = '<로컬 비밀번호>'
$env:JWT_SECRET = '<32바이트 이상 난수>'
.\gradlew.bat --version
.\gradlew.bat bootRun
```

```sh
# macOS / Linux: JAVA_HOME을 JDK 21 경로로 지정한 뒤 실행한다.
export DB_PASSWORD='<로컬 비밀번호>'
export JWT_SECRET='<32바이트 이상 난수>'
sh ./gradlew --version
sh ./gradlew bootRun
```

기본 주소는 `http://127.0.0.1:8080`이다. 종료는 `Ctrl+C`를 사용한다.

| 환경변수 | 기본값 | 용도 |
| --- | --- | --- |
| `SERVER_ADDRESS` | `127.0.0.1` | 로컬 수신 주소. 컨테이너에서는 이미지가 `0.0.0.0`으로 지정 |
| `SERVER_PORT` | `8080` | HTTP 수신 포트 |
| `JAVA_TOOL_OPTIONS` | JVM 기본값 | 컨테이너 메모리에 맞춘 JVM 옵션이 필요할 때 지정 |
| `SWAGGER_ENABLED` | `true` | OpenAPI 문서(`/v3/api-docs`)와 Swagger UI 노출. 운영 Compose에서는 `false` |
| `DB_URL` | `jdbc:postgresql://127.0.0.1:5432/app` | PostgreSQL JDBC URL |
| `DB_USERNAME` | `app` | DB 사용자 |
| `DB_PASSWORD` | 없음 (필수) | DB 비밀번호. 없으면 DB에 접속하기 전에 "DB_PASSWORD를 지정하세요"로 기동을 멈춘다 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 빈 값 | Google OAuth 클라이언트. 둘 중 하나라도 비면 Google 로그인 비활성(404) |
| `SSAFY_CLIENT_ID`, `SSAFY_CLIENT_SECRET` | 빈 값 | SSAFY 로그인 클라이언트. 비면 SSAFY 로그인 비활성(404) |
| `ADMIN_EMAILS` | 빈 값 | ADMIN으로 판정할 로그인 계정 이메일. 쉼표 구분, 공백·대소문자 무시 |
| `SIGNUP_CONSENT_TERMS_VERSIONS`, `SIGNUP_CONSENT_PRIVACY_VERSIONS`, `SIGNUP_CONSENT_DATA_VERSIONS` | 빈 값 | 가입 동의로 저장할 수 있는 이용약관·개인정보·데이터 활용 안내의 **허용 판**. 쉼표로 여러 판을 줄 수 있다(판을 바꾸는 배포 중에는 옛 판과 새 판을 함께 둔다). **빈 값이면 그 항목은 검사하지 않는다**(기존 동작). 값을 주면 목록에 없는 판은 422 `SIGNUP_CONSENT_VERSION_INVALID` |
| `FRONTEND_BASE_URL` | `http://localhost:5173` | 로그인 후 돌아갈 FE 주소. 운영은 서비스 도메인 |
| `OAUTH_REDIRECT_BASE_URL` | `http://localhost:8080` | 제공자에 보내는 콜백 URI의 앞부분. 콘솔에 등록한 리다이렉트 URI와 맞아야 한다 |
| `COOKIE_SECURE` | `true` | state·refresh 쿠키의 `Secure` 속성. Safari로 로컬 테스트할 때만 `false` |
| `JWT_SECRET` | 없음 (필수) | access 토큰 서명 키. UTF-8 32바이트 이상. 없거나 짧으면 "JWT_SECRET을 지정하세요"로 기동을 멈춘다. 만드는 법은 `.env.example` |
| `REDIS_HOST`, `REDIS_PORT` | `127.0.0.1`, `6379` | refresh 토큰 저장소. 운영 Compose는 `redis`, `6379` |
| `REDIS_PASSWORD` | 빈 값 | Redis 비밀번호. 운영 Compose의 같은 이름 값 |
| `REFRESH_TOKEN_STORE` | `redis` | `memory`면 Redis 없이 메모리에 보관(재시작 시 로그인 풀림, 로컬·테스트 전용) |
| `MANAGEMENT_HEALTH_REDIS_ENABLED` | `true` | Redis 없이 실행할 때 `false`. 켜져 있으면 Redis가 없을 때 `/actuator/health`가 503 |

설정은 환경변수로 전달한다. 로컬에서는 `BE/.env.example`을 `BE/.env`로 복사해 값을 채우면
`BE/`에서 실행할 때 자동으로 읽는다(`spring.config.import: optional:file:.env[.properties]`, 파일이 없으면 건너뜀).
형식은 `KEY=value`이며 따옴표를 붙이지 않는다. **`KEY=`처럼 값이 빈 줄은 "미설정"이 아니라 빈 문자열이다.**
기본값을 쓰려면 줄째 지우거나 주석(`#`)으로 둔다(주소·쿠키 설정은 빈 값이면 기본값으로 되돌린다).
같은 키가 OS 환경변수에도 있으면 환경변수가 이긴다. 운영 Compose는 `.env` 파일 없이 환경변수로 준다.
비밀값·개인 설정을 소스에 넣지 않는다. 루트 `.gitignore`가 `.env*`(`.env.example` 제외)와 키 파일을 제외한다.

## 곡·채보 마이그레이션 (94번)

`src/main/resources/db/migration/V2__create_songs_charts_chart_versions.sql`은
`songs` → `charts` → `chart_versions` 순서로 생성한다. 86번의 실제 V1 다음에 공통 Flyway 설정으로 자동 적용된다.
94번은 회원 테이블이나 DB 연결 설정을 별도로 도입하지 않는다. 운영 DB에 V2만 단독 적용하지 않는다.

- 공용 곡은 소유자가 없고 출처 메타데이터가 필수다. MIDI·AUDIO는 소유자 필수다. V31부터 MIDI 반주 키도 허용한다.
- 곡·난이도와 채보·버전 조합은 중복되지 않는다. 참조 중인 회원·곡·채보의 물리 삭제를 막는다.
- `notes`는 배열, `timing`은 객체이며 `note_count`는 노트 배열 길이와 일치해야 한다.
- `sheet_pages`는 선택적 이미지 페이지 배열이며 이미지 없는 JSON 전달은 SQL NULL로 저장한다.
  JSON 리터럴 `null`은 허용하지 않는다. 악보 렌더링은 BE 범위가 아니다.
- `notation_status`에는 기본값이 없다. JSON 내부 검증·준비 상태 판정·소유권 검사·기존 버전 덮어쓰기 방지는
  후속 등록/조회 API에서 구현한다. 이 SQL이 버전 행의 UPDATE를 금지하는 것은 아니다.

`ChartSchemaMigrationTest`는 86번의 임베디드 PostgreSQL 16을 재사용하고, 매 검사마다 별도 스키마를 만든다.
실제 V1만 적용해 회원·소셜 계정을 넣은 뒤 V2로 업그레이드하여 기존 데이터·FK 연결을 확인한다.
빈 스키마의 V1→V2 적용, Flyway validate·재실행 시 추가 적용 0건,
36개 제약 위반과 버전 보존·소프트 삭제·선택적 이미지 저장도 검사한다.
이 검사는 `gradlew build`와 CI의 일반 테스트에 포함되며 Docker나 별도 DB 설정이 필요 없다.

```powershell
.\gradlew.bat test --tests '*ChartSchemaMigrationTest'
```

Docker PostgreSQL 16에서 SQL만 따로 확인하려면 기존 보조 스크립트를 사용할 수 있다.
이 스크립트도 실제 V1·V2를 순서대로 적용하며, 호스트 포트·기존 볼륨을 사용하지 않는다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-ChartSchema.ps1
```

테스트 데이터·검증 SQL은 운영 JAR에 포함되지 않는다. 이미 적용한 마이그레이션은 수정·재번호화하지 않는다.

## 공용 연습 채보 초기 데이터 (99번)

`V10__seed_builtin_practice_charts.sql`은 Flyway가 새 DB와 기존 V9 DB에 자동 적용하는 내부 데모 데이터다. 스토리에서 계획한 자작·퍼블릭 도메인 10곡×3난이도 전체가 아니라, 반주 없이 FE 코드로 만든 연습 패턴 3개만 넣는다. Flyway 이력으로 재기동·재실행 시 중복 적재를 막는다.

| 제목 | 난이도 | BPM | 재생 길이 | 노트 수 |
| --- | --- | ---: | ---: | ---: |
| 기본 8비트 | EASY | 90 | 21,333ms | 96 |
| 8비트 + 필인 | NORMAL | 100 | 19,200ms | 104 |
| 라이드 16비트 | HARD | 120 | 16,000ms | 128 |

원본은 [FE/src/domain/chart.ts@d4080d10521263e6040f3ef6b2ddfe80cff3d771](https://lab.ssafy.com/s15-final/S15P31A307/-/blob/d4080d10521263e6040f3ef6b2ddfe80cff3d771/FE/src/domain/chart.ts)이며, `Math.round`로 계산된 `timeMs`와 같은 시각의 패드 삽입 순서를 그대로 저장한다. DB identity가 만든 song·chart·chart version ID는 고정하지 않으며 목록 API에서 받은 ID로 상세·최신·고정 버전을 조회한다. 세 버전 모두 반주·악보 이미지가 없고 `notation_status=UNAVAILABLE`이다.

`license`에는 프로젝트 FE 데모 패턴의 출처, 별도 라이선스 표기 없음, 음원 미포함 상태를 기록한다. 이는 저작권 합의를 대신하는 라이선스 선언이 아니다. 패턴을 바꾸거나 새 데이터를 추가할 때는 기존 버전을 수정하지 않고 다음 chart version과 확인된 권리 메타데이터를 새 Flyway 마이그레이션으로 추가한다.

### 기본 8비트 합성 반주 등록 (82번)

V12는 `accompaniment_key`를 AUDIO와 BUILTIN에 허용하되 소유자·출처 메타데이터 제약은 유지한다. 마이그레이션이나 앱 기동은 키를 자동 연결하지 않는다. 공용 기본 8비트 반주는 명시적 도구로만 기존 비공개 `accompaniment` 버킷에 등록한다. API에서는 로그인한 ACTIVE 회원이 기존 서명 URL 경로로 재생하며 개인 AUDIO는 계속 소유자만 조회한다.

등록 전에 이번 작업용 DB와 S3 호환 저장소를 준비하고 환경변수를 설정한 뒤 `BE/`에서 아래를 실행한다. 필요한 값은 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `CHART_ASSET_ENDPOINT`, `CHART_ASSET_PUBLIC_ENDPOINT`, `CHART_ASSET_REGION`, `CHART_ASSET_SHEET_BUCKET`, `CHART_ASSET_ACCOMPANIMENT_BUCKET`, `CHART_ASSET_ACCESS_KEY`, `CHART_ASSET_SECRET_KEY`다. endpoint·버킷·자격 증명을 로그에 기록하지 않는다.
이 Gradle 등록 작업은 Spring 설정을 불러오지 않으므로 `BE/.env`를 자동으로 읽지 않는다. 해당 값은 작업을 실행하는 셸의 프로세스 환경변수로 지정한다.
등록 도구 자격 증명에는 대상 반주 버킷의 GetObject·HeadObject·조건부 PutObject 권한이 필요하므로 운영 API의 읽기 전용 자격 증명과 구분해 등록 실행 프로세스에만 주입한다.
등록한 곡의 반주 음원은 변경하지 않으며, 변경이 필요하면 새 BUILTIN 곡 ID와 채보를 만들어 새 키로 배포한다.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21.0.11'
.\gradlew.bat registerBasic8Backing
```

도구는 V10의 기본 8비트 곡·EASY 채보·전체 96노트·90 BPM/4/4·길이·버전 메타데이터가 기준과 정확히 맞는지 먼저 확인한다. 반주는 `FE/src/audio/practiceBacking.ts`의 90 BPM·4/4·8마디 명세를 따라 44.1 kHz stereo PCM WAV로 직접 합성하며 외부 샘플을 쓰지 않는다. 기존 `accompaniment/{songId}.wav` 객체가 있으면 실제 바이트의 길이와 SHA-256이 일치할 때만 재사용하고, 새 객체는 조건부 업로드한다. 업로드 검증 뒤 DB 행을 잠그고 다시 검사해 키·출처 메타데이터를 한 트랜잭션으로 연결한다. 다른 채보·키·객체나 DB 경쟁이 발견되면 연결하지 않으며, 등록 객체만 남은 경우 같은 도구를 재실행할 수 있다. 도구 클래스는 운영 `bootJar`에 포함하지 않는다.

V12와 등록은 대상 DB에 적용해야 한다. 실제 배포 스토리지의 공개 프록시·CORS·Range 동작은 별도 확인이 필요하며 로컬 성공을 운영 검증으로 간주하지 않는다.

## 잔여 전체 DB 마이그레이션 (97~99번)

V1·V2를 변경하지 않고 다음 순서로 적용한다. 별도 수동 SQL 실행이나 `outOfOrder` 설정은 필요 없다.
병합 전 다른 작업의 신규 마이그레이션 번호와 충돌 여부를 확인한다.

| 버전 | 생성 테이블 |
| --- | --- |
| V3 | `kit_presets` |
| V4 | `chart_jobs`, `chart_job_attempts`, `chart_job_results`, `file_cleanup_tasks` |
| V5 | `play_sessions`, `hits` |
| V6 | `reports`, `recordings` |
| V7 | `telemetry_events` |
| V8 | `telemetry_events`를 TimescaleDB hypertable로 전환 (기존 데이터 보존) |
| V9 | `play_raw_uploads` 접수 기록 |
| V10 | FE 내부 데모 공용 연습 채보 3개 초기 적재 |

V1·V2·V9를 포함해 도메인 테이블은 총 16개다. 프리셋·로그·AI·리포트 API와 엔티티는
각 소비 기능에서 구현한다. 이번 변경은 테이블·제약·인덱스와 마이그레이션 검증이다.

- 프리셋 이름은 회원별 유일하고 기본 프리셋은 회원당 최대 하나다. 삭제해도 플레이 당시 스냅샷은 남는다.
- AI 작업은 회원별 비종료 작업 하나, 회원별 업로드 멱등 키 하나를 허용한다.
  먼저 QUEUED 작업을 생성하고 attempt를 만든 다음 `current_attempt_id`를 지정한다.
  현재 attempt와 단계별 접수 결과는 같은 job의 attempt만 참조한다.
  `(worker_id, claim_request_id)`와 `(job_id, stage)`는 유일하다.
  완료·실패 전환 시 `finished_at`도 함께 갱신하며 DONE의 progress는 100이다.
- `chart_job_results`는 접수 해시와 Receipt를 보존한다. 중복 요청에 Receipt를 재사용하는 서비스 로직,
  임대·revision 조건부 갱신, 회원 ACTIVE 확인 및 탈퇴 트랜잭션과의 잠금 순서는 후속 AI 연동에서 구현한다.
- 파일 정리 기록은 삭제 성공 후에도 키를 보존한다. 작업 접수 전 남은 고아 파일도 기록할 수 있다.
  재시도 대상에는 DELETING도 포함한다. 실행 중단 시 재획득과 삭제 확인, 만료된 PUT 권한의
  뒤늦은 업로드 재스캔은 후속 정리 작업의 책임이다. 객체 키는 재사용하지 않는다.
- 플레이 ID는 클라이언트 생성 UUID, 채보 버전 ID는 bigint다.
  요청 버전·SHA-256 해시는 필수다. RHYTHM/SHEET에는 곡·채보 버전·판정 컨텍스트가 필요하며
  FREE/TEMPO에는 곡·채보 버전을 연결하지 않는다.
- `hits.t_ms`·`delta_ms`는 소수 ms를 보존하며 NaN·무한대를 거부한다.
  카운트인 시점의 음수 `t_ms`는 허용한다. MISS는 실제 타격 수치 없이 noteId를 가진 행이며,
  PERFECT/GOOD은 noteId·velocity·delta가 필요하다. 판정 없는 타격은 velocity를 가진다.
  세션 내 seq·매칭 noteId는 각각 중복될 수 없다. 패드 이름의 최종 enum은 소비 API에서 검증한다.
- 회원·곡·채보 버전을 참조 중이면 물리 삭제를 막는다. 세션 삭제는 hits/reports를 함께 삭제하고,
  recordings의 세션 참조만 NULL로 만든다. 회원 탈퇴는 `users` 행을 지우지 않고 WITHDRAWN으로 바꾸며,
  같은 트랜잭션에서 그 회원의 녹음(257번)을 지운다. 연주 세션은 동의 여부와 관계없이 `domain.play.scheduler.WithdrawnPlayCleanup`이 1분 주기로 지운다(229, hits/reports는 cascade, 원본 접수는 세션 참조가 NULL이 되어 `RawLogCleanupWorker`가 객체를 회수). 남는 것은 MLflow 보정 기록의 익명 집계뿐이다.
- JSON 내부 필드, noteId 실재 여부, 곡과 채보 버전의 일치, 프리셋 소유권, 집계 일관성,
  해시 계산 및 결과 불변성은 CHECK/FK만으로 보장되지 않는다. 각 저장 서비스에서 검증한다.

텔레메트리는 V7에서 일반 테이블로 만든 뒤 V8에서 **1일 청크의 TimescaleDB hypertable**로 전환한다.
요약 업로드 전에도 저장하도록 세션·회원 FK를 두지 않는다. V30에서 **90일 보관 정책**을 등록해
오래된 청크를 자동으로 지운다(압축 정책은 없음, [텔레메트리 보관·탈퇴](#보관탈퇴-258번)). `packet_loss` 단위는 수집 계약에서 확정하며 DB는 유한한
음수 아닌 값만 검사한다. 원시 IMU 배열은 이 테이블에 저장하지 않는다.

`DatabaseSchemaMigrationTest`는 빈 DB의 V1→V7, V2 기존 데이터·이력 보존 업그레이드,
재실행 0건, JSON/수치/상태 제약, 중복 접수, 다른 작업 attempt 참조 거부,
삭제 연쇄·스냅샷 보존을 실제 임베디드 PostgreSQL 16에서 검사한다.

```powershell
.\gradlew.bat test --tests '*DatabaseSchemaMigrationTest'
.\gradlew.bat --no-daemon clean build
```

실패한 DDL은 Flyway 트랜잭션으로 롤백된다. 적용 후 앱을 롤백해도 테이블·데이터는 남긴다.
공유 DB에 `clean`을 실행하거나 적용된 V1~V8 파일을 수정하지 않고 후속 버전으로 변경한다.
FE 업로드 계약 합의·MR·CI·병합 확인 전에는 97번 전체를 완료로 간주하지 않는다.

### TimescaleDB 전환·검증

`Infra/docker-compose.yml`은 `timescale/timescaledb:2.30.2-pg16`을 사용한다.
V8의 확장 생성에는 권한이 필요하므로 최초 마이그레이션은 DB 관리자 권한으로 실행하거나,
관리자가 먼저 확장을 설치한 후 테이블 소유자 권한으로 실행한다.
확장 미설치·preload 누락을 건너뛰는 fallback은 없다. 일반 PostgreSQL만으로 운영 앱을 기동하면 V8이 실패한다.

기존 DB가 있으면 먼저 쓰기를 중단하고 백업 및 별도 DB 복원 검증을 수행한다.
기존 `pgdata` 볼륨을 무조건 지우거나 이미지 교체만으로 호환성을 가정하지 않는다.
PostgreSQL 메이저 버전은 16을 유지한다. V8은 기존 행을 이동하므로 데이터량에 따라
테이블 잠금 시간이 길어질 수 있다. 전환 후 행 수·주요 조회·Flyway 이력·hypertable을 확인한다.
앱만 롤백하는 경우 DB를 유지한다. 일반 PostgreSQL로 돌아가려면 백업 복원 또는 명시적인
데이터 역이관이 필요하며 확장을 CASCADE로 제거하지 않는다.

일반 마이그레이션 검사는 V8 확장 경계를 위해 임베디드 PostgreSQL에서 V1~V7까지 별도 검사한다. 애플리케이션 테스트 컨텍스트는 확장 전용 V8·V30을 제외한 나머지를 적용한다. `support.EmbeddedPostgresInitializer`의 `spring.flyway.target`은 복사본에 실제로 있는 최신 버전이어야 한다(현재 52). V8·V30 검사는 별도 필수 CI job
`be-timescale-test`가 수행한다. **마이그레이션을 추가하면 세 곳을 함께 올린다:** 위 target, `src/timescaleTest/.../TimescaleMigrationTest`의 적용 개수 2곳(V9까지 있는 DB에 V10 이후를 적용한 수, 새 DB에 전체를 적용한 수). 현재 CI는 `docker` 태그의 Linux Docker Runner에서
TimescaleDB service를 사용한다. 로컬 Windows 검증 스크립트에는 Linux Docker 엔진 접근과
이미지 pull 권한이 필요하다. 접근 실패 시 검사를 생략하지 않고 실패시킨다.
Gradle·JDK 설정은 기존 BE CI 설정을 공통으로 사용한다.
Windows Runner의 IPv6 수신 오류를 피하도록 `gradle.properties`에서 Gradle JVM도 IPv4로 고정한다.
`build.gradle`의 테스트 JVM IPv4 설정은 별도로 유지한다. `--no-daemon`도 일회용 Gradle 프로세스를
사용하므로 테스트 JVM 설정만으로 Gradle 시작 오류를 막을 수 없다.

```powershell
# BE/에서 실행. JAVA_HOME은 CI와 같은 JDK 21로 설정한다.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-TimescaleSchema.ps1
```

스크립트는 Compose에 선언된 이미지를 사용해 임시 DB를 띄우고 `timescaleTest`를 실행한 뒤 종료한다.
기존 볼륨을 쓰지 않고 tmpfs 및 임의의 루프백 포트만 사용한다. 빈 DB V1→V8,
데이터가 있는 V7→V8, 이력·행·인덱스 보존, 날짜별 청크 생성, CHECK 제약 및
재실행 0건, V30 보관 정책(90일 `policy_retention` job 1개)과 그 정책을 실제로 실행했을 때 90일 넘은 청크만
지워지는지, 같은 정책을 다시 등록해도 실패하지 않는지를 검사한다. 보관 정책이 상대 시각으로 동작하므로 테스트 데이터는
고정 날짜가 아니라 "오늘 기준 N일 전"으로 넣는다.

근거: [공식 2.30.2 릴리스](https://github.com/timescale/timescaledb/releases/tag/2.30.2),
[기존 테이블 전환 API](https://www.tigerdata.com/docs/reference/timescaledb/hypertables/create_hypertable).

## API 규약

모든 REST API가 공유하는 규칙이다. FE 클라이언트와 다른 BE 작업은 이 절을 기준으로 맞춘다.
설계 근거와 결정 과정은 작업 85번 설계 문서(개인 문서)에 있다.

### 성공 응답

성공은 HTTP 상태 코드로 표현하고 본문은 자원 DTO를 그대로 낸다. 별도 래퍼(`success`, `data`)는 쓰지 않는다.

| 상황 | 상태 | 본문 |
| --- | --- | --- |
| 조회 | 200 | 자원 DTO (record) |
| 목록 | 200 | JSON 배열. 페이지네이션이 필요하면 `PageResponse` |
| 생성 | 201 | 생성된 자원 DTO. `Location` 헤더는 선택 |
| 수정 | 200 | 수정된 자원 DTO |
| 삭제·본문 없는 처리 | 204 | 없음 |

페이지 응답 `global.response.PageResponse`는 `items`, `page`(0부터), `size`, `totalElements`,
`totalPages`, `hasNext` 필드를 가진다. `PageResponse.of(items, page, size, totalElements)`로 만든다.

JSON 규칙: 필드명은 camelCase, 시각은 `Instant`를 ISO-8601 UTC(`2026-10-19T07:00:00Z`)로,
열거형은 UPPER_SNAKE 문자열로 낸다. 숫자 ID는 JSON 숫자, uuid는 문자열이다.
성공 응답의 null 필드는 생략하지 않는다. 모르는 입력 필드는 무시한다.

### 오류 응답

모든 오류는 `Content-Type: application/problem+json`(RFC 9457)이며 `code`·`errors`를 확장 필드로 더한다.
클라이언트는 이 미디어 타입으로 오류를 식별하고 `code`로 분기한다. `detail`은 그대로 보여 줘도 되는 한국어 문장이다.

```json
{
  "type": "about:blank",
  "title": "입력값 검증 실패",
  "status": 400,
  "detail": "입력값을 확인해 주세요.",
  "instance": "/api/presets",
  "code": "VALIDATION_FAILED",
  "errors": [
    { "field": "name", "message": "공백일 수 없습니다" },
    { "field": "pads[2].key", "message": "1 이상이어야 합니다" }
  ]
}
```

| 필드 | 설명 |
| --- | --- |
| `type` | 고정 `about:blank` |
| `title` | 오류 코드의 한국어 제목 |
| `status` | HTTP 상태 코드와 같은 값 |
| `detail` | 사람이 읽는 한국어 설명. 500은 고정 문구만 내고 예외 메시지·스택을 노출하지 않는다 |
| `instance` | 요청 경로(쿼리 문자열 제외) |
| `code` | 기계 판별용 코드, UPPER_SNAKE |
| `errors` | 검증 실패일 때만. `field`(필드 경로 또는 파라미터 이름)와 `message`. 거부된 값은 넣지 않는다 |

공통 코드는 `global.error.CommonErrorCode`에 있다.

| 코드 | 상태 | 언제 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | 본문 파싱 실패, 필수 파라미터 누락, 타입 불일치, 분류되지 않은 4xx |
| `VALIDATION_FAILED` | 400 | `@Valid`·파라미터 제약 실패. `errors` 동반 |
| `UNAUTHORIZED` | 401 | 토큰 없음·만료·무효, 탈퇴 회원, refresh 실패. 사유는 `detail`로만 구분 |
| `FORBIDDEN` | 403 | ADMIN 전용 API에 USER가 접근. 소유자 검사 실패는 403이 아니라 도메인 `*_NOT_FOUND` 404다(다른 회원 자원의 존재를 드러내지 않는다). 가입 동의 전 회원의 차단은 도메인 코드 `SIGNUP_INCOMPLETE`(403, [인증과 토큰](#인증과-토큰)) |
| `NOT_FOUND` | 404 | 없는 경로. 도메인 자원이 없을 때는 도메인 코드 |
| `METHOD_NOT_ALLOWED` | 405 | |
| `NOT_ACCEPTABLE` | 406 | |
| `CONFLICT` | 409 | 도메인 코드가 없을 때의 기본 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | |
| `INTERNAL_ERROR` | 500 | 처리되지 않은 예외, 분류되지 않은 5xx |

도메인 코드는 각 도메인 패키지에 `{Domain}ErrorCode` enum을 두고 `global.error.ErrorCode`를 구현한다.
코드 문자열은 `{도메인}_{상황}` 형식이다 (예: `PRESET_NOT_FOUND` 404, `PLAY_NOT_FOUND` 404).
공통 코드에는 접두사가 없고, 같은 코드 문자열을 두 enum이 쓰지 않는다.

사용 규칙:

- 서비스·컨트롤러는 `BusinessException(errorCode)` 또는 `BusinessException(errorCode, detail)`만 던진다.
  상태·제목은 코드가 정한다. 컨트롤러에 `@ExceptionHandler`를 따로 두지 않는다.
- 요청 본문은 `@Valid`, 쿼리·경로 파라미터는 제약 애너테이션(`@Min` 등)을 직접 붙인다.
  검증 메시지는 `Accept-Language`와 무관하게 한국어다.
- Spring MVC 밖(서블릿 필터, Security 진입점·접근 거부 핸들러)에서는 `global.error.ErrorResponseWriter`를
  주입받아 `write(response, errorCode, detail, path)`로 응답한다. 자체 JSON을 만들지 않는다.
- 로그: 4xx는 WARN 한 줄(스택 없음), 5xx는 ERROR + 스택 1회. 검증 실패 로그에 값은 남기지 않는다.

### API 문서

- Swagger UI: `http://127.0.0.1:8080/swagger-ui.html` (→ `/swagger-ui/index.html`)
- OpenAPI JSON: `GET /v3/api-docs`, YAML: `GET /v3/api-docs.yaml`
- `SWAGGER_ENABLED=false`면 둘 다 404. 운영 Compose는 끈다.
- 모든 operation에 400·500 응답이 `ApiErrorResponse` 스키마로 자동 추가된다.
  401·403·404·409처럼 그 API에만 해당하는 응답은 `@ApiResponse`로 적는다.
- 보안 스킴 `bearerAuth`(HTTP bearer, JWT)가 등록돼 있다. 보호 API는
  `@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)`로 표시한다. 전역 requirement는 걸지 않는다.
- `/v3/api-docs/**`, `/swagger-ui/**`, `/swagger-ui.html`은 인증 없이 열려 있다. Swagger UI의 Authorize에
  `POST /api/auth/refresh`로 받은 `accessToken`을 넣으면 보호 API를 호출할 수 있다.

## DB와 마이그레이션

스키마는 `src/main/resources/db/migration`의 Flyway SQL만 정의한다. Hibernate는 엔티티가
스키마와 맞는지 기동 시 검증만 하므로, 엔티티를 바꾸면 같은 내용의 마이그레이션도 추가해야 한다.

| 버전 | 파일 | 내용 | 작업 |
| --- | --- | --- | --- |
| V1 | `V1__create_users_social_accounts.sql` | `users`, `social_accounts` | -86 |
| V11 | `V11__add_kit_presets_calibration.sql` | `kit_presets.calibration`(jsonb, 객체 또는 NULL) | -90 |
| V13 | `V13__drop_kit_presets_calibration.sql` | `kit_presets.calibration` 컬럼·CHECK 삭제(캘리브레이션은 프리셋에 저장하지 않음) | -128 |
| V14 | `V14__add_report_analysis_status.sql` | 저장된 리포트 분석 상태와 허용값 CHECK 추가 | -158 |
| V17 | `V17__widen_telemetry_pad_and_clock_offset.sql` | `telemetry_events` 패드 3컬럼 `varchar(16)`(HIHAT_PEDAL), `clock_offset_ms` `double precision`과 CHECK `ck_telemetry_events_clock_offset_ms` | -152 |
| V18 | `V18__add_report_analysis_dispatch.sql` | 리포트 약점 분석 시도 수·임대·재시도 시각 | -158 |
| V20 | `V20__widen_hits_pad.sql` | `hits` 패드 3컬럼 `varchar(16)`(HIHAT_PEDAL 저장 실패 수정) | -142 |
| V21 | `V21__create_coach_export_view.sql` | 약점 분석 보정용 비식별 뷰 `coach_export_v`, 그룹 역할 `coach_export_reader` | -142 |
| V22 | `V22__add_songs_published.sql` | `songs.published`(기본 true) 공용 곡 공개 여부, CHECK `songs_published_builtin_check`(개인 곡은 항상 true) | -156 |
| V23 | `V23__create_sheet_music.sql` | 내 악보 `sheet_music`·`sheet_music_pages`, 정리 역할 `SHEET_MUSIC` 추가 | -155 |
| V24 | `V24__allow_mpeg4_and_ogg_audio.sql` | 음원 MIME 확장(`audio/mp4`·`audio/ogg`), 기존 행 보존 | -267 |
| V25 | `V25__add_users_data_consent.sql` | `users.data_consent`(boolean, null=미응답)·`data_consent_at`, CHECK `ck_users_data_consent`(둘 다 null이거나 둘 다 값) | -199 |
| V26 | `V26__add_users_signup_consents.sql` | 가입 동의 `users.data_consent_version`·`terms_version`·`terms_agreed_at`·`privacy_version`·`privacy_agreed_at`(판 `varchar(50)`, 시각 `timestamptz`, 모두 NULL 허용). `ck_users_data_consent`를 값·시각·판 셋이 함께 있거나 함께 없게 교체, `ck_users_terms_consent`·`ck_users_privacy_consent`(판·시각 함께, 판은 공백만 불가) 추가. 판 없이 값만 있던 행은 세 값 모두 NULL로 되돌린다. 기존 행은 채우지 않는다(동의 전으로 시작) | -199 |
| V27 | `V27__add_recording_hits.sql` | `recordings`에 녹음 시퀀스 `hits`(jsonb 배열)·`hit_count`(1~50,000, 배열 길이와 같음)·`client_key`(uuid)·`mode`·`input_source`·`schema_version`·`started_at`·`payload_hash`·`updated_at` 추가(모두 NOT NULL), `duration_ms` NOT NULL. 부분 유일 인덱스 `recordings_user_client_key_idx`(user_id, client_key) WHERE deleted_at IS NULL. 기존 행이 있으면 실패한다(쓰는 코드가 없었음) | -256 |
| V28 | `V28__add_recording_chart_version.sql` | `recordings.chart_version_id`(bigint, NULL 허용, FK `chart_versions`) 추가. 녹음이 플레이와 별개로 채보 버전을 기억해 목록 `song`·상세 `timing`이 플레이 삭제 뒤에도 남는다. 기존 행은 연결된 플레이의 `chart_version_id`로 채운다 | -257 |
| V29 | `V29__add_song_level.sql` | 곡 난이도·산정 채보 버전·규칙·곡 길이와 기존 곡 예외 대상을 저장한다 | -269 |
| V30 | `V30__add_telemetry_retention_policy.sql` | `telemetry_events`에 TimescaleDB 보관 정책 `add_retention_policy(90 days, if_not_exists)` 등록. 확장 전용이라 V8처럼 일반 테스트 복사본에서 제외하고 `timescaleTest`에서 검증한다 | -258 |
| V31 | `V31__midi_accompaniment.sql` | MIDI 원본 접수·비동기 반주 작업·시도와 객체 정리 참조를 추가하고 MIDI 곡의 반주 키를 허용한다 | -274 |
| V32 | `V32__add_coach_narrative.sql` | `reports.coach_summary`(AI 종합 총평 jsonb)와 LLM 총평 작업 큐 `coach_narrative_jobs`를 추가한다 | COACH-003 후속 |
| V33 | `V33__add_chart_features.sql` | 곡 추천 R1: 채보 버전별 특징 테이블. 추천 요청마다 노트 JSON을 읽지 않도록 미리 계산해 둔다. 미계산 채보는 행이 없고 후보에서만 빠진다 | 곡 추천 R1 |
| V34 | `V34__add_recommendation_items.sql` | 곡 추천 R1: 노출·클릭 기록. 가중치 보정과 R3 평가의 근거, 탈퇴 때 삭제, 보관 90일 | 곡 추천 R1 |
| V35 | `V35__add_chart_features_rhythm_grid.sql` | 곡 추천 R2: 채보 특징에 리듬 격자(한 박 12칸 위치 비율) 추가. NULL은 미계산, 제외 채보는 `{"excluded": …}` | 곡 추천 R2 |
| V36 | `V36__add_recommendation_similar.sql` | 곡 추천 R2: 노출 기록 `context`에 `SIMILAR` 허용, 기준 곡 열 추가 | 곡 추천 R2 |
| V37 | `V37__add_recommendation_r3.sql` | 곡 추천 R3: 추천 학습 동의, 후보 저장, AI 배치가 읽는 가명 뷰와 `recommend_export_reader` 역할 | 곡 추천 R3 |
| V38 | `V38__add_song_metadata.sql` | 곡 추천용 공용 곡 메타데이터 `song_metadata`(값 목록·개수 CHECK)와 AI 배치 뷰 `recommend_song_meta_v`. 값은 카탈로그 `meta`에서 앱 시작 때 넣는다 | -255 |
| V39 | `V39__create_telemetry_session_conditions.sql` | 측정 세션 실험 조건 `telemetry_session_conditions`. `(user_id, session_id)` PK, 7개 조건 열(`firmware_0`·`firmware_1`·`dongle_firmware`·`link_mask` 0~15·`haptic_enable`·`sensor_mount` `GRIP_FRONT`/`BENCH`·`app_build`·`note` 200자)과 `received_at`. FK·보관 정책 없음 | -259 |
| V40 | `V40__add_recommendation_drill.sql` | 연습 추천: 노출 기록 `context`에 `DRILL` 허용 |
| V41 | `V41__exclude_withdrawn_from_coach_export.sql` | 보정 뷰 `coach_export_v`에서 탈퇴 회원 제외. 열은 그대로 |
| V42 | `V42__recommend_interactions_consented_plays.sql` | 추천 학습 입력에서 `consent=false` 세션 제외. 열은 그대로 |
| V43 | `V43__add_recommendation_consent_history.sql` | 추천 학습 동의 이력 `user_recommendation_consent_history`. 추가만 하며 철회·탈퇴일부터 2년 뒤 삭제 |
| V44 | `V44__add_sheet_music_song.sql` | 내 악보와 개인 곡 연결: `sheet_music.song_id`(nullable FK `songs`)와 부분 유일 인덱스 `sheet_music_song_live_idx`(살아 있는 행의 `song_id`). 곡당 살아 있는 악보 하나 | -248 |
| V45 | `V45__add_recommendation_user_keys.sql` | R3 가명 키를 비밀 값 해시에서 무작위 대체 키로 교체. 뷰 열은 그대로 |
| V46 | `V46__add_musicxml_source.sql` | MusicXML 업로드(293): `songs.source` CHECK에 `MUSICXML`, `chart_versions.generator` CHECK에 `MUSICXML_RULE` 추가(제약 이름 `songs_source_check`·`chart_versions_generator_check` 재생성). 기존 행 변경 없음 | -293 |
| V47 | `V47__create_live_coach_jobs.sql` | 연주 중 LLM 구간 코칭 작업 큐 `live_coach_jobs`(공개 번호, 사용자, 판 번호, 구간 사실 jsonb, 상태, 임대, 결과 `title`≤8자·`sub`≤16자). 짧게 살다 지워지는 표 | -299 |
| V48 | `V48__add_lessons.sql` | 입문 코스 레슨 `lessons`(곡별 순서·종류 `READ`/`PLAY`·설명·패드·`guide`, 카탈로그가 유일한 출처)와 알아보기 완료 기록 `lesson_completions`(사용자·곡 PK). 곡을 지우면 함께 지워진다. 11/10 V47로 병합됐으나 -299의 V47과 겹쳐 번호만 바꿨다 | -331 |
| V50 | `V50__add_lesson_course.sql` | 학습 코스 `lessons.course`(`BEGINNER`·`INTERMEDIATE`, 기존 행은 `BEGINNER`). 순서 유일 조건을 `position`에서 `(course, position)`으로 바꿨다. 진도 표는 그대로 | 학습 코스(중급) |
| V51 | `V51__create_chart_worker_presence.sql` | 채보 워커별 마지막 연락 시각 `chart_worker_presence`(`worker_id` PK, `last_seen_at`). claim·heartbeat가 올 때마다 갱신한다 | -383 |
| V52 | `V52__widen_live_coach_sub.sql` | 연주 중 LLM 구간 코칭 `live_coach_jobs.sub`를 `varchar(16)`에서 `varchar(20)`으로 늘림. 검증 상한 `LiveCoachQueue.MAX_SUB`도 20(QA 2026-11-16: 16자로는 구체적인 지시가 안 들어감) | -300 |

규칙:

- 파일명은 `V{번호}__{설명}.sql`이다. 규칙에 어긋난 파일은 무시되지 않고 기동이 실패한다.
- 번호는 담당자별 대역 없이 팀 공통으로 1씩 늘린다. MR 병합 직전에 `develop-BE`에 적용된 마지막 번호를 확인해 다음 번호를 쓴다.
- 이미 병합된 파일은 고치거나 번호를 바꾸지 않는다. 변경은 새 번호의 파일로 추가한다. `outOfOrder`는 쓰지 않는다.
- 이 MR이 의존성·설정을 이미 넣었으므로, 이후 마이그레이션 MR은 SQL 파일만 추가하면 된다.
- 제약·인덱스 이름은 아래 규칙을 따른다. 오류 메시지와 이후 `ALTER`에서 이름으로 찾기 위해서다.

| 종류 | 형식 | 예 |
| --- | --- | --- |
| 기본 키 | `pk_{table}` | `pk_users` |
| 외래 키 | `fk_{table}_{column}` | `fk_social_accounts_user_id` |
| 유니크 | `uq_{table}_{의미}` | `uq_social_accounts_provider_user` |
| CHECK | `ck_{table}_{column 또는 의미}` | `ck_users_status` |
| 인덱스 | `ix_{table}_{columns}` | `ix_social_accounts_user_id` |

엔티티 규칙: 시각은 `Instant`(DB `timestamptz`), 열거형은 `@Enumerated(EnumType.STRING)`(DB `varchar`),
PK는 `bigint GENERATED ALWAYS AS IDENTITY`와 `GenerationType.IDENTITY`다. 문자열 길이는 SQL과 엔티티에 같은 값을 적는다.
`open-in-view`는 꺼져 있으므로 지연 로딩은 트랜잭션 안(서비스)에서 끝낸다.

### 테스트 DB

일반 `test`는 임베디드 PostgreSQL 16을 자동으로 받는다. 이 검사에는 Docker나 로컬 DB가 필요 없다.
`src/test/resources/META-INF/spring.factories`에 등록된 `support.EmbeddedPostgresInitializer`가
테스트 JVM당 서버를 한 번 띄우고 모든 테스트 컨텍스트의 DataSource로 넣는다. 각 컨텍스트가 뜰 때
Flyway가 V29까지 적용한다(V8은 확장 없는 임베디드 DB에서 제외). V8 확장 의존 검증은 위 TimescaleDB 전용 검사에서 수행한다.

- 리포지토리·스키마 테스트는 `@DataJpaTest`를 쓴다. 내장 DB로 바꾸지 않도록 설정돼 있어 같은 PostgreSQL을 쓴다.
- 모든 테스트가 같은 DB를 공유하므로 데이터를 남기지 않는다. `@DataJpaTest`는 테스트마다 롤백되고,
  `@SpringBootTest`에서 데이터를 쓰면 `@Transactional`로 롤백하거나 직접 지운다.
- 최초 실행 때 PostgreSQL 바이너리 jar를 Gradle 캐시로 받는다.
- 테스트 회원으로 보호 API를 부를 때는 가입 게이트에 막히지 않도록 `support.SignupConsentFixtures`로 가입 완료 상태를 만든다.
  JPA로 만들면 저장 전에 `users.save(SignupConsentFixtures.completed(User.create(...)))`, SQL로 넣었으면 `SignupConsentFixtures.complete(db, id)`.

## 소셜 로그인

Google·SSAFY OAuth 2.0 Authorization Code 방식이다. 자체 회원가입은 없다. 콜백은 BE가 받고,
FE는 로그인 버튼에서 아래 `login` 주소로 **브라우저를 이동**시키기만 한다(fetch로 호출하지 않는다).
결정 근거는 FE 요청 `ACCT-001_소셜로그인-결정-전달`과 작업 87번 설계 문서(개인 문서)에 있다.

| 메서드·경로 | 동작 |
| --- | --- |
| `GET /api/auth/{provider}/login` | `provider` = `google` \| `ssafy`. 제공자 동의 화면으로 302, state 쿠키 `oauth_state` 설정 |
| `GET /api/auth/{provider}/callback` | 제공자가 돌려보내는 주소. 성공하면 `{FRONTEND_BASE_URL}/auth/callback`, 실패하면 `{FRONTEND_BASE_URL}/login?error={access_denied\|oauth_failed}`로 302 |

- 없거나 키가 설정되지 않은 제공자는 두 경로 모두 404 `AUTH_PROVIDER_NOT_SUPPORTED`다. 기동 로그에 "비활성" WARN이 남는다.
- `access_denied`는 사용자가 동의 화면에서 취소한 경우, `oauth_failed`는 그 밖의 모든 실패(state 불일치, 토큰 교환·사용자 정보 조회 실패, 탈퇴 회원 등)다. 상세 사유는 서버 WARN 로그에만 남고 인가 코드·토큰·이메일은 기록하지 않는다.
- state는 서버 세션 없이 `oauth_state` 쿠키(HttpOnly, `SameSite=Lax`, `Path=/api/auth`, 5분)로 확인하고 콜백에서 지운다. 로그인을 두 번 연달아 시작하면 앞선 콜백은 실패한다.
- 회원은 (제공자, 제공자 사용자 ID)로 찾는다. Google은 `sub`, SSAFY는 `userId`다. 같은 사람이라도 Google과 SSAFY로 로그인하면 서로 다른 회원이다(계정 연결 없음).
- 최초 로그인 때만 닉네임(제공자 이름, 30자로 자름, 없으면 `사용자`)과 프로필 이미지(500자 초과·없음은 null, SSAFY는 항상 null)를 채운다. 이후 로그인에서는 덮어쓰지 않는다.
- 역할은 로그인할 때마다 `ADMIN_EMAILS`로 다시 정한다(목록에서 빠지면 다음 로그인에 USER). Google은 `email_verified=true`인 이메일만, SSAFY는 이메일을 검증된 것으로 본다.
- 제공자 토큰은 사용자 정보 조회에만 쓰고 저장하지 않는다. 콜백이 성공하면 우리 서비스의 refresh 쿠키를 심는다(`domain.auth.service.token.LoginSessionIssuer`). 이후 흐름은 [인증과 토큰](#인증과-토큰).
- 외부 호출 시간 제한은 연결 3초·응답 5초(`spring.http.clients.*`)다.

제공자 설정은 `application.yaml`의 `auth.providers.{key}`에 있다(인가·토큰·사용자 정보 URI, scope, 클라이언트 인증 방식 `BASIC`/`POST`, 응답 속성 이름).
제공자를 추가하려면 같은 형식의 블록과 `domain.user.model.SocialProvider` 값을 추가한다. 마이그레이션은 필요 없다.

### 콘솔 등록과 로컬 확인

1. 콘솔에 리다이렉트 URI를 등록한다. Google: `http://localhost:8080/api/auth/google/callback`,
   SSAFY: `http://localhost:8080/api/auth/ssafy/callback`. `OAUTH_REDIRECT_BASE_URL` 뒤에 `/api/auth/{provider}/callback`을 붙인 값과 글자까지 같아야 한다(`127.0.0.1`과 `localhost`도 다르다).
2. Google 클라이언트가 "테스트" 게시 상태면 로그인할 계정을 테스트 사용자로 추가한다.
3. `BE/.env`에 키를 넣고 `bootRun`한 뒤 브라우저에서 `http://localhost:8080/api/auth/google/login`을 연다.
   동의하면 `FRONTEND_BASE_URL/auth/callback`으로 돌아온다(FE가 떠 있지 않으면 연결 실패 화면이지만 주소창으로 결과를 확인할 수 있다).
   `users`·`social_accounts`에 행이 생기고 서버 로그에 `로그인 성공 provider=google userId=…`가 남는다.

운영은 `FRONTEND_BASE_URL`·`OAUTH_REDIRECT_BASE_URL`을 `https://{서비스 도메인}`으로 주고, 같은 콜백 URI를 콘솔에 추가 등록한다.
## 곡·채보 조회 (96번)

| GET 경로 | 응답 |
| --- | --- |
| `/api/v1/songs` | `items`, `page`, `size`, `totalElements`, `totalPages`, `hasNext` |
| `/api/v1/songs/{songId}` | 곡 메타데이터와 난이도별 최신 `chartVersionId` 요약 |
| `/api/v1/songs/{songId}/accompaniment` | 곡 단위 반주 URL 발급 및 갱신(채보 버전 불필요) |
| `/api/v1/charts/{chartId}` | 해당 채보의 가장 큰 `version`에 해당하는 노트·시간 정보 |
| `/api/v1/chart-versions/{chartVersionId}` | 지정 버전의 노트·시간 정보 |
| `/api/v1/chart-versions/{chartVersionId}/assets` | 같은 버전의 이미지·반주 URL 발급 및 갱신 |

목록은 `source=BUILTIN`(기본) 또는 `MINE`, `q`(앞뒤 공백 제거 후 100자 이내),
`page=0`(0~100000), `size=20`(1~100)을 받는다. 제목·아티스트를 대소문자 구분 없이 부분 검색한다.
`%`, `_`, `!`도 문자 그대로 검색하며 생성 시각 내림차순, 동률이면 ID 내림차순이다.
`source` 요청값은 목록 범위이며 응답의 곡 출처 `BUILTIN`/`AUDIO`/`MIDI`/`MUSICXML`(293번)과 다르다.
목록과 count에 같은 권한 조건을 적용하며, 난이도 요약은 일괄 조회한다. 목록 SQL에는 큰 노트 JSON을 넣지 않는다.

**같은 채보 난이도 숨김(260번):** 목록의 `difficulties`와 상세의 `difficulties`·`charts[]`에서 최신 버전 노트 수(`noteCount`)가 NORMAL과 같은 HARD·EASY를 뺀다. NORMAL·EASY는 HARD에서 노트를 빼기만 해서 만들므로(151번 솎기, 음원 채보도 같음) NORMAL = HARD는 노트 수가 같으면 같은 채보다. EASY는 HARD에서 따로 솎으므로 노트 수만 같고 노트가 다른 경우가 이론상 있지만 받아들인다(설계 U2). NORMAL은 항상 남기고, NORMAL이 없는 곡은 숨기지 않는다. 그래서 곡마다 난이도가 1~3개다(예: 시드 3곡은 `EASY`·`NORMAL`). 채보는 세 난이도 모두 저장된 그대로이므로 `/api/v1/charts/{chartId}`·`/api/v1/chart-versions/{id}`는 숨긴 채보도 200이고, 플레이·베스트·녹음의 `difficulty`와 ADMIN 응답(`/api/v1/admin/songs*`)은 바뀌지 않는다. FE는 응답 목록대로 난이도를 그리고, URL의 `chart`가 목록에 없으면 NORMAL로 바꾼다(FE 합의 `CHART-002_중복-난이도-숨김`).

모든 경로는 로그인한 ACTIVE 회원 전용이다. 공용 곡도 로그인해야 하며 타인·삭제·없는 자원은 동일한 404다.
ADMIN도 타인의 개인 곡에 접근할 수 없다. 내 생성 중·실패 곡은 메타데이터만 조회할 수 있고
재생·자산 조회는 409다. 응답은 `Cache-Control: private, no-store`이며 오류는 기존 Problem Details 형식이다.
토큰이 없거나 무효라 인증 필터가 막은 401은 Security 기본값(`no-cache, no-store, max-age=0, must-revalidate`)이다.

88번 인증과 연결돼 있다. `domain.chart.controller.query.AuthenticatedChartQueryUserResolver`가 인증 필터가 검증한 access 토큰의
`AuthUser.id`만 돌려준다([인증과 토큰](#인증과-토큰)). 토큰 검증·만료·탈퇴 회원은 인증 모듈이 401로 처리하고,
조회 모듈은 외부 파일 작업 뒤 DB의 ACTIVE 상태를 다시 확인한다.
클라이언트가 전달한 userId 쿼리·헤더·가짜 토큰을 사용하는 임시 로그인 기능은 없다.
조회 테스트는 실제 access 토큰을 `Authorization` 헤더로 보낸다.
곡 목록·상세와 추천의 채보 요약은 `ChartQueryService.summaries`가 가시성과 최신 버전을 적용해 곡 단위로 일괄 조회하고 표시 중복을 제거한다.

### FE 소비 계약

- 곡 단위 반주 조회는 `accompanimentUrl`과 `expiresAt`을 반환하며 반주가 없으면 둘 다 null이다. 같은 경로를 재호출하면 다시 서명한다. URL은 메모리에서만 쓰고 만료 전 재발급한다. 서명 중 반주가 교체되면 503 `CHART_ASSET_UNAVAILABLE`이므로 같은 경로를 재시도할 수 있다.
- 곡 상세에서 난이도와 `chartVersionId`를 고르고, 플레이 시작 이후에는 버전 조회와 assets 갱신에 그 ID를 사용한다.
  최신 채보 API를 다시 호출해 플레이 도중 버전을 바꾸지 않는다.
- `notes`는 저장 순서와 `noteId`, `timeMs`, `pad`를 유지한다. `timeMs`에 `offsetMs`를 다시 더하지 않는다.
  `velocityHint`, `notation`, `hihatOpen`, `durationMs`, 확장 timing 필드는 없으면 null이며 가짜 기본값을 채우지 않는다.
- 워커 노트의 `hihatOpen`은 선택 Boolean이다. 신규 결과에서 부재·null·Boolean만 허용한다. 조회 시 `HIHAT`의 Boolean `true`·`false`를 반환하고, 부재·null·과거의 다른 타입과 다른 패드의 값은 null이다. null은 하이햇이 닫혔다는 뜻이 아니라 열림 상태를 알 수 없다는 뜻이다. MIDI 업로드의 46번(열린 하이햇)에 `true`를 기록하며 42·44의 기존 패드 매핑은 유지한다. 기존 채보는 소급 변환하지 않는다.
- `timing`은 버전에 저장된 값이다. 곡의 현재 BPM으로 대체하지 않는다. `beatsPerBar`는 박자표의 분자이며
  `6/8`을 `6/4`로 해석하면 안 된다. 변박은 `timeSignatureMap`을 함께 사용한다.
- `notationStatus=PENDING`/`UNAVAILABLE`여도 정상 노트는 조회할 수 있다. `READY`에 이미지가 없는 경우도 유효하다.
- ID는 공통 BE 계약대로 JSON 숫자다. FE string ID 모델로 옮길 때 `Number.isSafeInteger` 확인 후 변환한다.
- assets 응답은 `chartVersionId`, `notationStatus`, `sheetPages`, `accompanimentUrl`, `assetsExpireAt`이다.
  페이지는 `page`, `imageUrl`, `fromTick`, `toTick`, `fromMs`, `toMs`를 포함하고 시작 포함/끝 미포함이다.
  페이지 순서를 정렬하며 템포 변경 전체를 적분해 ms를 계산한다. offset은 한 번만 적용한다.
  `ppq`·`tempoMap` 등 매핑 근거가 없거나 모순되면 `CHART_SHEET_TIMING_UNAVAILABLE`(409)다.
- 자산이 없으면 `sheetPages=[]`, `accompanimentUrl=null`, `assetsExpireAt=null`이다.
  자산이 있으면 `assetsExpireAt`은 발급된 URL 중 가장 이른 만료 시각이다. 노트 응답에는 URL·내부 키가 없다.

### S3 호환 저장소 연결

40번에서 결정한 실제 저장소에 맞춰 실행 환경에 다음 값을 주입한다. 기본은 비활성화다.

| 환경변수 | 의미 |
| --- | --- |
| `CHART_ASSET_ENABLED` | 연결 시 `true` |
| `CHART_ASSET_ENDPOINT` | BE가 HEAD로 객체 존재를 확인할 내부 S3 API endpoint |
| `CHART_ASSET_PUBLIC_ENDPOINT` | 브라우저가 서명 GET으로 접근할 공개 S3 API endpoint |
| `CHART_ASSET_REGION` | 서명 region, 기본 `us-east-1` |
| `CHART_ASSET_SHEET_BUCKET` / `CHART_ASSET_ACCOMPANIMENT_BUCKET` | 비공개 이미지 / 반주 버킷 |
| `CHART_ASSET_ACCESS_KEY` / `CHART_ASSET_SECRET_KEY` | 읽기 권한 키. 저장소·로그에 기록하지 않음 |
| `CHART_ASSET_URL_TTL` | URL 유효기간. 기본 `10m`, 허용 1~10분 |

AWS SDK의 SigV4, path-style URL을 사용한다. 활성화 시 필수 설정이 없으면 기동을 실패시킨다.
내부·공개 endpoint는 같은 저장소를 가리켜야 하며, 프록시는 서명된 Host·경로·쿼리를 보존해야 한다.
현재 연결은 S3 호환 저장소의 고정 접근 키 방식이다. STS 세션 토큰·역할 자격 증명은 아직 연결하지 않았다.
파일은 조회 요청에서 업로드하지 않는다. 저장 키는 92번 경계에 맞춰 다음 형식을 검사한다.

- 이미지: `sheet/{chartVersionId}/{파일명}.png|jpg|jpeg|webp` (파일명은 영문·숫자·`_`·`-`)
- 반주: `accompaniment/{songId}.wav|mp3|ogg|flac|m4a` 또는 곡별 불변 UUID 경로. AUDIO·MIDI 또는 자체 합성 BUILTIN 곡에 허용

생성·저장 담당자는 이 키 규칙에 맞춰 연결해야 한다. 임의 URL, 타인 버전, 임시 원본·드럼 트랙,
경로 이동 문자열은 서명하지 않는다. 객체 부재는 `CHART_ASSET_NOT_FOUND`(404), 미설정·저장소 장애는
`CHART_ASSET_UNAVAILABLE`(503)이며 자산이 없는 정상 응답으로 숨기지 않는다.
GET URL은 inline 재생·표시 용도이고 별도 다운로드 API는 제공하지 않는다.

스토리지 호출 동안 DB 트랜잭션을 유지하지 않는다. 응답 직전에 회원 ACTIVE·곡 소유권·삭제 상태를
다시 조회하며, 그 전에 커밋된 탈퇴는 401, 삭제는 404로 차단한다. 이미 발급된 URL은 만료까지 유효할 수 있다.
내부 키·토큰·서명 URL을 접근 로그에 남기지 않아야 한다.

조회 테스트는 실제 임베디드 PostgreSQL, MVC, SDK 서명과 로컬 HTTP HEAD 서버를 사용한다.
다른 트랜잭션에서 탈퇴·삭제를 커밋하는 경합과 외부 호출 시 DB 트랜잭션 부재도 확인한다.
**40번 실제 스토리지의 프록시·만료·Range·CORS 검증은 별도로 남아 있다.**
해당 통합 검증, MR CI·리뷰·develop-BE 병합 전에는 96번 전체 완료로 처리하지 않는다.

## 키트 프리셋 (90번)

로그인한 회원이 자기 키트 프리셋을 저장·조회·수정·삭제하고, 하나를 기본으로 지정한다. 프리셋 내용은
**패드 배치(`layout`)·사운드(`sounds`)** 두 가지이며 모두 FE 형식의 JSON 객체다.
서버는 내용을 해석하지 않고 객체인지와 크기(각 16 KiB)만 검사한다. 센서 캘리브레이션은 기기·세션 값이라 저장하지 않는다
(V11에서 넣은 `calibration`은 V13에서 삭제, -128).
설계는 작업 90번 설계 문서(개인 문서)에 있다.

| 메서드·경로 | 본문 | 성공 | 도메인 오류 |
| --- | --- | --- | --- |
| `GET /api/presets` | — | 200 배열. 기본 프리셋이 있으면 첫 원소, 나머지는 최근 생성 순 | — |
| `POST /api/presets` | 요청 본문 | 201 + `Location: /api/presets/{id}` | 409 `PRESET_NAME_DUPLICATE`·`PRESET_LIMIT_EXCEEDED`·`PRESET_CONFLICT` |
| `GET /api/presets/{id}` | — | 200 | 404 `PRESET_NOT_FOUND` |
| `PUT /api/presets/{id}` | 요청 본문(이름·배치·사운드를 모두 보낸다) | 200. 기본 여부는 그대로 | 404, 409 `PRESET_NAME_DUPLICATE`·`PRESET_CONFLICT` |
| `PUT /api/presets/{id}/default` | 없음 | 200. 이전 기본은 해제. 이미 기본이면 그대로 | 404, 409 `PRESET_CONFLICT` |
| `DELETE /api/presets/{id}` | — | 204. 기본을 지우면 남은 것 중 가장 최근 생성이 기본이 된다 | 404 |

요청 본문:

| 필드 | 필수 | 규칙 |
| --- | --- | --- |
| `name` | 예 | 앞뒤 공백을 잘라 1~50자. 내 프리셋끼리 같은 이름 불가(대소문자 구분) |
| `layout` | 예 | JSON 객체(FE `KitLayout`) |
| `sounds` | 예 | JSON 객체. 1단계는 `{"soundSetId":"ssaplash"}` |
| `schemaVersion` | 아니오 | 1 이상 정수. 누락이면 1. FE가 위 두 JSON 형식을 바꿀 때 올린다 |

표에 없는 필드는 무시한다. 옛 FE 빌드가 `calibration`을 보내도 400이 아니라 저장 없이 성공한다.

응답은 `id`, `name`, `isDefault`, `layout`, `sounds`, `schemaVersion`, `createdAt`, `updatedAt`
여덟 필드다. 소유자 id는 내보내지 않는다. JSON은 jsonb로 저장되므로 키 순서·공백은 보낸 것과 다를 수 있다.

| 코드 | 상태 | 언제 |
| --- | --- | --- |
| `PRESET_NOT_FOUND` | 404 | 없는 id, **다른 회원의 프리셋**(ADMIN 포함. 존재 여부를 드러내지 않는다) |
| `PRESET_NAME_DUPLICATE` | 409 | 같은 이름의 내 프리셋이 이미 있음 |
| `PRESET_LIMIT_EXCEEDED` | 409 | 이미 10개(FE 로컬 상한과 같다) |
| `PRESET_CONFLICT` | 409 | 같은 회원의 동시 요청이 DB 제약(이름 유일·기본 1개)에 걸림. 다시 호출하면 된다 |

FE 소비 계약: 로그인 복원 뒤 `GET /api/presets` 한 번으로 목록과 기본 프리셋을 함께 받는다(전용 "기본 조회" API 없음).
첫 프리셋을 바로 기본으로 하려면 생성 뒤 `PUT …/default`를 한 번 더 부른다. 로그인 전 로컬 프리셋은 서버로 옮기지 않는다(91).

연결점: 쓰기는 트랜잭션 첫 단계에서 `UserQueryService.lockAndCheckActive`로 회원을 잠그고 ACTIVE를 다시 확인한다(아니면 401).
탈퇴 트랜잭션(`domain.withdrawal.service.WithdrawalService`)이 `domain.preset.service.KitPresetService.deleteForWithdrawal(userId)`로 지운다(`users` 행을 남기므로 cascade에 기대지 않는다).
플레이 로그의 `play_sessions.kit_preset_id`는 프리셋 삭제 시 NULL이 되고 스냅샷은 남는다(V5).
V3의 `tuning` 컬럼은 이 API가 쓰지 않는다(SETUP-03, 2단계).

## 인증과 토큰

세션 없이 토큰으로 인증한다. 계약은 FE 요청 `ACCT-001_소셜로그인-결정-전달`의 회신, 탈퇴·WS 연동은 BE2와의
mail(`PLAN_곡채보-접근정책`, `CHART-003_채보결과-탈퇴-경합`)에서 정했다. 설계는 작업 88번 설계 문서(개인 문서)에 있다.

흐름: 로그인 콜백이 refresh 쿠키를 심고 FE `/auth/callback`으로 302 → FE가 `POST /api/auth/refresh`로 access 토큰을 받는다
→ API 호출마다 `Authorization: Bearer {accessToken}` → 401이면 refresh를 **한 번** 부르고 원래 요청을 다시 보낸다
→ 그래도 401이면 로그인 화면. 새로고침 뒤 메모리 토큰을 복구할 때도 refresh를 부른다.

| 메서드·경로 | 인증 | 결과 |
| --- | --- | --- |
| `POST /api/auth/refresh` | `refresh_token` 쿠키 | 200 `{accessToken, tokenType: "Bearer", expiresIn: 1800}` + 새 `refresh_token` 쿠키. 실패는 401 `UNAUTHORIZED` "다시 로그인해 주세요." |
| `POST /api/auth/logout` | 쿠키(없어도 됨) | 204. 서버의 refresh 토큰을 지우고 쿠키를 만료시킨다. 여러 번 불러도 같다 |
| `GET /api/users/me` | Bearer | 200 `{id, provider, nickname, profileImageUrl, role, createdAt, updatedAt, signupCompleted, consents, dataConsent}`. `signupCompleted`는 이용약관·개인정보 동의가 둘 다 있으면 true(역할과 무관, ADMIN도 사실대로). `consents`는 항상 객체 `{terms, privacy}`이고 각 항목은 `{version, agreedAt}` 또는 동의 전 null. `dataConsent`는 항상 객체 `{agreed, version, updatedAt}`이고 동의 전이면 셋 다 null. 이메일·상태는 내보내지 않는다. 가입 동의 전에도 부를 수 있다 |
| `POST /api/users/me/signup-consent` | Bearer | 본문 `{termsVersion, privacyVersion, dataConsent: {agreed, version}}` → 200 + `/me` 본문(`signupCompleted: true`). 판 3개는 필수(누락·null·빈 값·공백만·51자 이상은 400 `VALIDATION_FAILED`), `dataConsent` 누락·null도 400. **연주 기록 활용은 필수라 `agreed`는 true만 받는다**(false·null·누락은 400, `errors[].field = dataConsent.agreed`). 본문 없음·JSON 오류는 400 `INVALID_INPUT`. 가입을 마친 회원이 다시 보내도 200(약관 개정 재동의)이며 판이 바뀐 항목만 동의 시각과 회원 `updatedAt`이 갱신되고 같으면 그대로다. 서버는 판을 비교·해석하지 않는다. 토큰 없음·저장 순간 탈퇴는 401. 가입 동의 전에도 부를 수 있다 |
| `DELETE /api/users/me` | Bearer | 204(본문 없음) + `refresh_token` 쿠키 만료. 본인만 탈퇴하며 되돌릴 수 없다. 동시에 두 번 부르면 늦은 쪽은 401. 가입 동의 전에도 부를 수 있다(가입 취소) |

연주 기록 활용 동의는 가입 동의 `POST`로만 저장하며, 철회는 탈퇴다(199의 `PUT /api/users/me/data-consent`는 삭제했다).

| 항목 | access 토큰 | refresh 토큰 |
| --- | --- | --- |
| 형식 | HS256 JWT. 클레임 `iss=airdrum-api`, `sub`(회원 id), `iat`, `exp`만. 권한은 넣지 않는다 | 32바이트 난수(Base64 URL 43자) |
| 수명 | 30분(만료 판정 허용 오차 60초) | 14일. 재발급할 때마다 새 값·새 14일 |
| 전달 | 응답 본문 → FE 메모리 → `Authorization` 헤더. 쿼리·쿠키로 받지 않는다 | 쿠키 `refresh_token`: `HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=1209600` |
| 서버 보관 | 없음 | Redis에 SHA-256 해시만. 원문은 저장·로그하지 않는다 |

- **매 요청 회원 확인**: 필터가 토큰 서명·만료를 본 뒤 `users`를 PK로 조회해 ACTIVE인지 확인하고, 권한도 DB 값을 쓴다.
  탈퇴하면 다음 요청부터 401이고, `ADMIN_EMAILS` 변경으로 권한이 바뀌면 다음 로그인 뒤 바로 반영된다.
- **refresh는 1회용**이다. 쓴 토큰은 즉시 무효이고, 같은 쿠키로 동시에 부르면 하나만 성공한다. FE는 refresh를 한 번에 하나만 실행한다.
  이미 쓰였거나 로그아웃된 토큰으로 부르면 401이지만 쿠키는 지우지 않는다(동시 재발급에서 이긴 요청의 새 쿠키를 지우지 않기 위해).
  쿠키가 없거나 형식이 틀리거나 탈퇴 회원이면 401과 함께 쿠키를 지운다.
- 로그아웃해도 이미 받은 access 토큰은 만료(최대 30분)까지 유효하다. FE는 메모리에서 버린다.
- **탈퇴**하면 같은 access 토큰의 다음 요청부터 401이고 refresh도 401이다. FE는 204를 받으면 메모리 토큰을 버리고 로그인 화면으로 보낸다.
  `users` 행은 WITHDRAWN으로 남되 닉네임은 "탈퇴한 사용자", 이메일·프로필 이미지는 NULL로 비운다. 소셜 연동·키트 프리셋·refresh 토큰·연주 녹음·텔레메트리와
  학습 데이터 사용에 동의하지 않은 플레이 기록은 지우고, 동의한 플레이 기록은 남긴다. 같은 소셜 계정으로 다시 로그인하면 **새 회원**이다.
  가입 동의 기록(이용약관·개인정보·연주 기록 활용의 판·시각·값 7개 컬럼)도 같은 UPDATE로 비운다.

### 가입 동의와 접근 제한

소셜 인증 콜백은 지금처럼 회원을 바로 만든다(ACTIVE). 이용약관·개인정보 동의 시각이 둘 다 있어야 **가입 완료**이며, 기존 회원도
V26 이후 동의 전으로 시작한다. FE는 `/me`의 `signupCompleted`가 false면 가입 동의 화면을 띄우고 `POST /api/users/me/signup-consent`로 저장한다.
- **허용 판 검증:** 가입 동의 API는 화면 없이도 직접 부를 수 있다(개발자 도구 콘솔에서 `/api/auth/refresh`로 토큰을 받아 호출하면 된다). 그래서 서버가 허용 판 목록(`SIGNUP_CONSENT_*_VERSIONS`)이 설정된 항목의 판만 저장한다. 응답과 로그에는 보낸 판 값을 담지 않고 어느 항목인지(`termsVersion`·`privacyVersion`·`dataConsent.version`)만 알린다. 이 검사는 사용자가 본인 계정으로 API를 부르는 것을 막지는 못하고 **유효한 판만 기록에 남게** 한다. XSS로 심은 스크립트의 대리 호출은 CSP(`Infra/nginx/default.conf`)가 막는다(`Infra/SECURITY.md` 18절). 판을 바꿀 때 배포 순서는 ① 서버 설정에 새 판을 **추가**(옛 판 유지) ② FE 배포 ③ 옛 판 제거다.

- **가입 게이트**(`domain.auth.security.SignupGateFilter`, 인증 필터 바로 뒤): 인증된 `USER`가 가입 미완료면 아래 허용 목록 밖 요청을
  403 `SIGNUP_INCOMPLETE` "가입 동의가 필요합니다."로 끝낸다. 메서드와 경로가 정확히 같아야 통과한다.
  - 허용: `GET /api/users/me`, `POST /api/users/me/signup-consent`, `DELETE /api/users/me`, `POST /api/auth/refresh`, `POST /api/auth/logout`, 모든 `OPTIONS`
- 토큰이 없거나 무효면 게이트를 거치지 않고 지금처럼 401이 먼저다. 게이트는 인증된 요청만 본다.
- `ADMIN`은 게이트를 면제한다. 단 `/me`의 `signupCompleted`는 사실대로 내려간다.
- 동의를 저장하면 같은 access 토큰의 다음 요청부터 통과한다(가입 완료 여부는 토큰이 아니라 매 요청 DB 조회 값).
- `/ws/jobs/**`(BE2 WebSocket)는 막지 않는다. 인증 결과 `AuthUser.signupCompleted()`로 막을 수 있다.
- **정리 배치**(`domain.withdrawal.scheduler.PendingSignupCleanup`): 동의 없이 떠난 신규 계정을 지운다. 대상은 V26 적용 시각
  (`flyway_schema_history`, 처음 실행 때 한 번 읽음. 이력이 없으면 WARN 후 건너뜀) 이후 생성되고, 이용약관·개인정보 동의가 모두 없고,
  생성 뒤 `user.signup.pending-ttl-days`(기본 7)일이 지난 ACTIVE 회원이다. 회원마다 `DELETE FROM users`(소셜 연동·프리셋·녹음은 FK
  CASCADE) 후 refresh 토큰을 폐기하며, 실패(FK 위반 등)는 WARN 로그 후 다음 회원으로 넘어간다. 주기는
  `user.signup.cleanup-interval-ms`(기본 3,600,000 = 1시간). V26 이전에 생긴 기존 회원은 지우지 않는다.

공개 경로(토큰 없이 통과): `GET /api/auth/*/login`, `GET /api/auth/*/callback`, `POST /api/auth/refresh`, `POST /api/auth/logout`,
`/actuator/health/**`, `/v3/api-docs/**`, `/swagger-ui/**`, `/internal/**`(BE2가 별도 체인으로 인증), `OPTIONS`.
**나머지는 없는 경로도 미인증이면 404가 아니라 401이다.** 401·403은 [오류 응답](#오류-응답) 형식이며 401에는 `WWW-Authenticate: Bearer`가 붙는다.

| 상황 | 상태 | `code` | `detail` |
| --- | --- | --- | --- |
| 토큰 없음 | 401 | `UNAUTHORIZED` | 로그인이 필요합니다. |
| 만료 | 401 | `UNAUTHORIZED` | 액세스 토큰이 만료되었습니다. |
| 서명·형식·발급자 불일치, `Bearer` 아닌 헤더 | 401 | `UNAUTHORIZED` | 액세스 토큰이 올바르지 않습니다. |
| 탈퇴·없는 회원 | 401 | `UNAUTHORIZED` | 사용할 수 없는 계정입니다. |
| ADMIN 전용에 USER | 403 | `FORBIDDEN` | 권한이 없습니다. |
| 가입 동의 전 USER가 허용 목록 밖 API 호출 | 403 | `SIGNUP_INCOMPLETE` | 가입 동의가 필요합니다. |

### 다른 모듈에서 인증 쓰기

- **컨트롤러**: 메서드 인자에 `domain.user.model.AuthUser me`를 선언하면 인증된 회원(`id`, `role`, `signupCompleted`)이 들어온다. 소유자 판단은 항상 `me.id()`로 하고
  클라이언트가 보낸 회원 ID는 믿지 않는다. 문서에는 파라미터로 나오지 않는다. 클래스에 `@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)`를 붙인다.
- **ADMIN 전용**: `@PreAuthorize("hasRole('ADMIN')")`. USER는 403이다.
- **컨트롤러 밖**(인터셉터·연결 어댑터): `domain.auth.security.CurrentAuthUser.find()`로 현재 요청의 `AuthUser`를 꺼낸다. 예: `domain.chart.controller.query.AuthenticatedChartQueryUserResolver`.
- **WebSocket**(BE2): 연결 뒤 첫 메시지의 토큰으로 `domain.auth.security.AuthenticationService.authenticate(token)`을 부르면
  `AuthenticatedUser(user, expiresAt)`가 온다(실패는 `AccessTokenException`, 사유 `getReason()`). 전송마다 `expiresAt` 경과와
  `findActive(userId)`로 다시 확인한다. 토큰을 URL 쿼리로 받지 않는다. HTTP 필터는 WS 메시지를 처리하지 않는다.
- **회원 상태와 겨루는 저장**: 채보 결과 커밋은 `WorkerQueue.lock`의 SQL로, 음원·MIDI·MusicXML 업로드 접수는 `UserQueryService.requireActiveForShare(userId)`로 트랜잭션에서 회원 행을 잠그고 `ACTIVE`를 확인한다(`FOR SHARE`). 이 채보 경로의 잠금 순서는 `users` → `songs` → `chart_jobs`다.
  플레이 요약 저장과 원본 업로드 시작·확정은 각 트랜잭션에서 `UserQueryService.requireActiveForShare(userId)`로 세션보다 회원을 먼저 잠그며, 파일 전송은 원본 업로드 시작과 확정 사이에서 수행한다. 이 서비스는 호출 트랜잭션이 필수다.
- **`/internal/**`**: 이 API 체인(`@Order(2)`)에서는 열려 있다. AI 워커 인증은 `@Order(1)` + `securityMatcher("/internal/**")`인 별도
  `SecurityFilterChain`으로 더한다.
- **탈퇴**(`domain.withdrawal.service.WithdrawalService`, 149번): 한 트랜잭션에서 `users`를 `FOR UPDATE`(`UserRepository.findByIdForUpdate`)로 잠그고
  ACTIVE를 확인한 뒤 WITHDRAWN으로 바꾸면서 개인정보 컬럼을 비우고(`User.withdraw`), 소셜 연동·키트 프리셋·연주 녹음·`telemetry_events`(258)·`telemetry_session_conditions`(259) 삭제,
  `RefreshTokenService.revokeAllOf`(Redis 실패는 WARN 로그 후 계속),
  `domain.user.event.UserWithdrawnEvent(userId)` 발행까지 한다. 그 밖의 회원 데이터(곡·파일·채보 작업)를 정리하는 모듈은
  `@TransactionalEventListener(phase = AFTER_COMMIT)`로 이 이벤트를 받고 DB 변경은 `REQUIRES_NEW`로 연다. 롤백된 탈퇴에는 호출되지 않는다.
  리스너 예외는 탈퇴 응답(204)에 영향이 없으므로 직접 로그를 남긴다. 놓친 정리는 `UserRepository.findWithdrawnIds(withdrawnAfter, pageable)`
  (탈퇴 시각·id 순)로 다시 찾는다.

### Redis 키

| 키 | 값 | TTL |
| --- | --- | --- |
| `refresh:token:{SHA-256 16진}` | 회원 id. 재발급·로그아웃은 `GETDEL`로 한 번에 읽고 지운다 | 14일 |
| `refresh:user:{회원 id}` | 그 회원의 토큰 해시 집합(탈퇴 때 일괄 삭제용) | 발급마다 14일로 연장 |

Redis가 죽으면 로그인 콜백(`oauth_failed`)과 refresh·logout이 2초 안에 실패한다. 이미 받은 access 토큰으로 하는 API 호출은 영향이 없다.

### 로컬 확인

1. Redis를 띄우고(`docker run … redis:7-alpine`, [로컬 실행](#로컬-실행)) `.env`에 `JWT_SECRET`을 넣은 뒤 `bootRun`한다.
2. 브라우저에서 `http://localhost:8080/api/auth/google/login` → 동의 → `FRONTEND_BASE_URL/auth/callback`으로 돌아오면
   개발자 도구 Application 탭의 `localhost` 쿠키에 `refresh_token`이 있다.
3. 같은 브라우저 콘솔에서 `await (await fetch('/api/auth/refresh', {method: 'POST'})).json()` (FE 개발 서버 프록시 경유 또는
   `http://localhost:8080` 페이지에서) → `accessToken`. Swagger UI의 Authorize에 넣고 `GET /api/users/me`를 호출한다.
4. `docker exec airdrum-redis redis-cli --scan --pattern 'refresh:*'`로 키를 확인한다. 로그아웃하면 `token` 키가 사라진다.

## 검증과 패키징

```powershell
.\gradlew.bat clean build
$env:DB_PASSWORD = '<로컬 비밀번호>'
java -jar build/libs/app.jar
```

macOS/Linux에서는 `sh ./gradlew clean build`를 사용한다.
현재 별도 린터는 없으며 `build`가 컴파일·테스트·실행 JAR 생성을 수행한다. 테스트에는 DB 준비가 필요 없다.
테스트 DB는 `127.0.0.1`에만 바인딩하고 JDBC도 같은 주소를 사용한다. Windows Runner의
`localhost` 소켓 연결 실패를 피하도록 테스트 JVM에만 `java.net.preferIPv4Stack=true`를 적용한다.
공통 DB 테스트는 풀 밖에서 새 JDBC 연결 10개를 순차 생성해 IPv4 루프백 연결도 확인한다.
테스트는 실제 HTTP 서버에서 health/liveness/readiness 응답, 관리 엔드포인트 비노출,
OpenAPI 문서·Swagger UI 노출과 토글을 확인하고, `@WebMvcTest`로 예외 종류별 오류 응답 형식과
로그 규칙을 확인한다. `@DataJpaTest`로 마이그레이션 결과(컬럼·제약·cascade)와 엔티티·리포지토리를 확인한다. 테스트 소스의 `ErrorProbeController`는 이를 위한 전용 컨트롤러이며
운영 JAR에는 포함되지 않는다. 결과는 `build/reports/tests/test/index.html`에서 확인한다.

소셜 로그인 테스트는 실제 제공자를 부르지 않는다. 제공자 호출은 `MockRestServiceServer`가 대신하며,
단위 범위는 `@RestClientTest`, 엔드포인트 범위는 `@SpringBootTest` + `@AutoConfigureMockMvc` +
`@AutoConfigureMockRestServiceServer`(Boot 4 패키지 `org.springframework.boot.restclient.test.autoconfigure`)를 쓴다.
`BE/`에서 테스트를 돌리면 로컬 `.env`도 읽히므로, 인증 설정에 의존하는 테스트는 쓰는 환경변수를 `@SpringBootTest(properties = …)`로 모두 지정한다.

인증 테스트는 Redis 없이 돈다. `support.TestPropertyDefaultsInitializer`(`spring.factories` 등록)가 모든 테스트 컨텍스트에
refresh 저장소 `memory`와 Redis 헬스 비활성을 강제하고, `JWT_SECRET`이 없으면 테스트 전용 키를 넣는다.
보호 API를 부르는 테스트는 `AccessTokenService.issue(new AuthUser(id, role), Instant.now())`로 토큰을 만들어 `Authorization` 헤더에 넣는다.
테스트 소스의 `domain.auth.security.AuthProbeController`(`/api/test-auth/me`, `/admin`)는 인증·인가 확인 전용이다.
`@WebMvcTest` 슬라이스에는 우리 Security 체인이 없고 Boot 기본 체인이 붙으므로, 인증과 무관한 슬라이스는
`@AutoConfigureMockMvc(addFilters = false)`로 필터를 뺀다. 이 경우 로그에 "generated security password"가 나오지만 슬라이스에만 해당한다.

GitLab의 `be-test`, `be-build`는 BE·DB 문서·인프라·CI 등 공통 파일이 바뀌는 MR과 기존 workflow가 허용하는
통합 브랜치 파이프라인에서 실행된다. 열린 MR이 있는 `develop-BE` push의 중복 파이프라인은 만들지 않으며,
main 대상 MR과 main 브랜치 파이프라인은 변경 경로와 무관하게 모든 BE 필수 검사를 실행한다. 일반 BE 대상 MR과 `develop-BE` push는
FAST `be-test` 한 작업에서 전체 소스와 테스트를 컴파일하고 인증·입력·채보·집계의 고정 단위 테스트 13개 클래스와 앱 JAR 빌드를 실행한다.
공통 코드 변경도 FAST이며 서버·DB·WebSocket·외부 프로세스 통합 검사는 main 통합 시 FULL에서 확인한다.
BE 대상 경로가 없는 일반 FE·AI·EMB MR에는 BE job을 만들지 않는다. `Docs/API/examples`는 테스트 입력이므로
BE 대상 경로다. FULL에서만 별도 앱 JAR·실제 FluidSynth 렌더·Timescale·워커 JAR job을 생성한다.
MR을 만들기 전의 push 파이프라인은 소급하여 제거하지 않는다. main 배포·예약 보정 규칙은 유지한다.
현재 `.gitlab-ci.yml`은 `docker` 태그의 Linux Docker Runner와 `eclipse-temurin:21-jdk`를 사용한다.
Gradle에 `--build-cache`를 사용해 컴파일 결과를 재사용할 수 있지만 테스트 결과는 캐시하지 않고 CI에서 매번 실행한다.
전체 검사에서 필수인 `be-midi-worker-build`는 `bootMidiWorkerJar`를 실행하고 워커 JAR을 별도 아티팩트로 보관한다.
전체 검사에서 필수인 `be-timescale-test`는 `timescale/timescaledb:2.30.2-pg16` service에 연결해
`./gradlew --no-daemon --build-cache timescaleTest`를 실행한다. 로컬 Windows에서는 JDK 21과 `gradlew.bat`를
사용하고 기존 루프백·테스트 JVM IPv4 설정을 유지한다. 로컬 통과와 실제 CI 통과는 구분한다.
Runner 연결·운영과 CD는 인프라 작업 범위다.

### 플레이 리포트 집계·조회 (S15P31A307-157)

신규 RHYTHM·SHEET 업로드는 검증된 hits에서 BE 통계를 계산하고 세션·hits·reports를 한 트랜잭션으로
저장한다. 저장 실패 시 전체 롤백한다. 집계 계산은 트랜잭션 밖에서 수행하며 AI 호출이나 raw 로그
업로드를 기다리지 않는다. FREE·TEMPO는 리포트를 생성하지 않는다. 업로드 응답의 `rawLogStatus`는
원본 로그 상태이며 리포트 상태가 아니다. 신규 scored 업로드 201 직후 조회할 수 있다.

**점수 규칙(`report/model/ScoreRule`, 330번):** 점수 = PERFECT×100 + GOOD×(GOOD 점수), 정확도 = 점수 ÷ 채보 노트 수(소수 둘째 자리 HALF_UP). 규칙 버전은 업로드 `judgementContext.judgementVersion`이고 기록에 그대로 저장된다.

| 버전 | GOOD 점수 | 비고 |
| --- | --- | --- |
| `SCORE_V1` | 60 | 11/12까지의 규칙. 옛 화면·늦게 올라오는 기록을 위해 계속 받는다 |
| `SCORE_V2` | 80 | 11/12 팀 결정. 지금 FE가 보내는 값. 전부 GOOD이면 80%라 입문 코스 통과(70%)를 넘는다 |

업로드는 기록이 보낸 버전의 규칙으로 점수·정확도를 검산하고(어긋나면 400 `PLAY_PAYLOAD_INVALID`, 모르는 버전은 409 `PLAY_SCHEMA_UNSUPPORTED`) 받은 값 그대로 저장한다. 지난 기록은 다시 계산하지 않는다(V1 기록은 V1 점수 그대로, 최고 기록 비교에 섞인다).

내부 저장 통계는 `BE_REPORT_V1`이다. FE 회신을 반영한 공개 응답은 저장 DTO와 분리한다.

- `timingHistogram`: PERFECT·GOOD의 deltaMs만 10ms 구간으로 집계한다. 판정창을 10ms 단위로
  올림한 ±범위이며 마지막 구간만 우측 끝값을 포함한다. MISS·미매칭 타격은 제외한다.
- `padStats`: 신규 리포트는 enum 순서의 9패드이며 기존 리포트는 8패드일 수 있다. 과거 `HI_TOM`은 조회 시 `SMALL_TOM`으로 반환한다. accuracy는 `(perfect+g×good)/(perfect+good+miss)`(g는 그 기록 점수 규칙의 GOOD 점수 ÷ 100: V1 0.6, V2 0.8)의
  내부 저장은 0~1 비율(소수 넷째 자리 HALF_UP)이다. **API accuracy는 모두 0~100, 소수 둘째 자리 HALF_UP**이며
  패드 값은 원본 판정 개수에서 직접 계산한다. 평가 표본이 없으면 null이다. 전체 summary 값은 그대로 유지한다.
- `meanDeltaMs`, `meanVelocity`: PERFECT·GOOD 표본의 평균(소수 둘째 자리 HALF_UP), 표본 없으면 null.
  `sampleCount`는 PERFECT+GOOD이며 `judgementCounts`에 패드별 판정 건수를 기록한다.
  평가 노트 수는 PERFECT+GOOD+MISS다. sampleCount와 혼동하지 않는다. chartNoteCount는 이번 응답에 없다.
- `weak_segments`·`recommended_drills`는 초기 null이다. 같은 UUID·본문 재전송은 기존 리포트를
  갱신하지 않아 AI 결과도 보존한다. 배포 전 리포트 없는 세션의 재전송도 백필하지 않는다.

`ReportAggregatorTest`는 소수 구간 경계·무표본·MISS·미매칭·50,000건을,
`PlayUploadApiTest`는 실제 PostgreSQL과 인증 경로에서 저장·재전송·동시성·롤백을 검사한다.
`ReportQueryApiTest`는 업로드→조회, 백분율·중단·null, 소유권·오류 코드, 커서·페이지 상한과 삭제 경합의 읽기 스냅샷을 검사한다.
전체 검증 명령은 위의 Gradle test·bootJar 및 TimescaleDB 검증 절을 따른다.

리포트 API는 Bearer 인증과 본인 소유권을 확인하며, 성공 DTO를 직접 반환한다.

| API | 응답·규칙 |
| --- | --- |
| `GET /api/v1/plays/{playId}/report` | id, playId, score, accuracy, maxCombo, judgementCounts, timingHistogram, padStats, mode, inputSource, endReason, analysisStatus, weakSegments, recommendedDrills, generatorVersion, generatedAt, coachSummary, songId, chartId, difficulty(연주한 곡·채보. 곡이 삭제돼도 id는 그대로, 값이 없으면 null) |
| `GET /api/v1/plays/{playId}/report/notes?afterSeq=4&limit=1000&fromMs=7000&toMs=12000` | items, nextAfterSeq. `fromMs`·`toMs`(선택)를 주면 노트 시각이 fromMs 이상 toMs 미만인 노트만 돌려준다(노트 시각은 PERFECT·GOOD이 tMs−deltaMs, MISS가 tMs). 약점 구간 재생용이다. 둘의 순서가 뒤바뀌거나 유한하지 않으면 `VALIDATION_FAILED`. limit 기본 500·범위 1~1000. afterSeq 생략 시 처음부터, 명시 시 0~2147483647. seq 오름차순·커서 초과 행을 limit+1개 읽어 다음 페이지 판별 |

notes.items는 seq, matchedNoteId, tMs, pad, judgement, deltaMs, velocity다. PERFECT·GOOD·MISS만 반환하고
미매칭 타격은 제외한다. MISS의 deltaMs·velocity는 null이다. seq가 0·4·9, limit=2이면 첫 커서는 4이고
다음 페이지가 9를 반환한다. 끝에서는 nextAfterSeq=null이다. seq는 시간순이 아니며 FE가 유효타의 노트 시각을
tMs−deltaMs, MISS는 tMs로 구한다. 그래프 전체 로딩 속도를 페이지 분리만으로 보장하지 않는다.

두 API 모두 읽기 전용 REPEATABLE_READ이며 요약 조회는 hits를 읽지 않는다. 현재 곡 삭제 상태·raw 저장소·AI 가용성에
의존하지 않는다. endReason=null을 완료로 추정하지 않으며, meanDeltaMs는 부호 있는 편향이다.
`analysisStatus`는 DB에 저장된 NOT_REQUESTED/PENDING/DONE/FAILED 값을 반환하며 신규 리포트는 PENDING으로 분석을 시작한다.
기존 NOT_REQUESTED 리포트는 자동 분석하지 않는다. weakSegments·recommendedDrills의 null/[] 구분과 저장된 배열은 그대로 전달한다.
AI 호출과 상태 전환은 [리포트 약점 분석](#리포트-약점-분석-158번-후속)을 따른다.

미인증·만료·탈퇴는 401, UUID·쿼리 오류는 400이다. 없는 세션·타인 세션은 `PLAY_NOT_FOUND` 404,
본인 리포트 없음·FREE/TEMPO는 `REPORT_NOT_FOUND` 404이며 ProblemDetail의 code로 분기한다.
배포 전 리포트 없는 세션은 동일 업로드 200을 다시 받아도 백필되지 않는다.

FE 회신 기준 흐름은 종료 직후 로컬 요약 표시 → 업로드 후 요약/첫 페이지 프리패치 → 서버 상세 리포트다.
종료 후 3초 표시 대상의 기능명세 반영과 FE 통합 검증은 별도이며, 상세 리포트 요약+첫 페이지 3초는 실측 전 목표다.

## 컨테이너 실행

저장소 루트에서 실행한다. Docker Desktop의 Linux 엔진 또는 Linux Docker가 필요하다.

```sh
docker build -t airdrum-api:local ./BE
docker run --rm --name airdrum-api -p 127.0.0.1:8080:8080 \
  -e DB_URL=jdbc:postgresql://host.docker.internal:5432/app -e DB_PASSWORD=<로컬 비밀번호> \
  airdrum-api:local
```

다른 터미널에서 `docker stop airdrum-api`로 종료한다.
이미지 빌드는 테스트 없이 실행 JAR만 만든다. 테스트는 CI의 `be-test`가 맡는다
(테스트용 임베디드 PostgreSQL은 root로 실행되는 빌드 단계에서 뜨지 않는다). 실행 이미지는 JRE 21, 음원 검사용 FFmpeg와 JAR를 포함한다.
앱은 UID/GID `10001`로 실행한다. 소스 외 파일과 `.env`는 빌드 컨텍스트에 포함하지 않는다.

인프라 Compose 연결 기준:

- 빌드 컨텍스트: `BE/`, Dockerfile: `BE/Dockerfile`
- 컨테이너 수신 포트: `8080`, HTTP
- 상태 확인: `GET /actuator/health/readiness`, HTTP 200 및 JSON `status: "UP"` 확인. DB만 포함하고 Redis는 포함하지 않는다.
  `GET /actuator/health`는 Redis도 포함하므로 컨테이너 healthcheck에 쓰지 않는다(Redis 장애로 앱이 불량 판정되지 않게)
- 프로세스 확인: `/actuator/health/liveness`, 요청 수신 준비 확인: `/actuator/health/readiness`
- 종료: SIGTERM, 요청 처리 대기 최대 20초. Compose 종료 유예는 30초 이상 권장
- 로그: 표준 출력. 영속 볼륨 불필요
- 운영 공개 진입점은 Nginx로 두고 앱 포트는 내부 네트워크에서 연결

- DB 연결: 환경변수 `DB_URL=jdbc:postgresql://postgres:5432/${POSTGRES_DB}`, `DB_USERNAME=${POSTGRES_USER}`,
  `DB_PASSWORD=${POSTGRES_PASSWORD}`. `postgres`의 healthcheck가 통과한 뒤 기동한다(`depends_on` `service_healthy`)
- Redis 연결: `REDIS_HOST=redis`, `REDIS_PORT=6379`, `REDIS_PASSWORD=${REDIS_PASSWORD}`. `redis`도 `depends_on` `service_healthy`
- 토큰: `JWT_SECRET`(32바이트 이상 난수, 비밀). 바꾸면 발급된 access 토큰이 모두 무효가 된다(refresh로 다시 받으면 된다)

`/actuator/health`와 readiness는 DB 연결 상태를 포함한다. DB에 붙지 못하면 둘 다 503이고 liveness는 200을 유지한다.
DB가 응답하지 않을 때 503은 커넥션 풀 대기 시간 5초(`spring.datasource.hikari.connection-timeout`)가 지난 뒤에 나온다.
healthcheck의 `timeout`은 5초보다 길게(예: 10초) 둔다. 짧으면 503 대신 시간 초과로 실패한다.
DB를 쓰는 일반 요청도 장애 중에는 5초 안에 500으로 끝난다. DB가 돌아오면 앱 재시작 없이 다시 200이 된다.
기동 시 DB에 접속하지 못하면 Flyway 단계에서 앱이 종료된다. Nginx·DB·Redis Compose와 배포 구성은
[#38](https://ssafy.atlassian.net/browse/S15P31A307-38),
[#47](https://ssafy.atlassian.net/browse/S15P31A307-47)에서 연결한다.


## 음원 접수 (159번)

`POST /api/v1/songs/audio`는 Bearer 인증과 UUID `Idempotency-Key`, multipart `file`, `title`, 선택적 `artist`를 사용한다. MP3/WAV, MPEG-4 오디오(AAC·ALAC), Ogg Opus 음원 파일은 최대 50MiB(52,428,800바이트), 길이는 0초 초과 10분 이하이며 전체 multipart 요청은 51MiB까지다. 새 형식은 실제 바이트와 스트림을 검사하며 파일명·클라이언트 MIME을 신뢰하지 않는다. MPEG-4는 `audio/mp4`, Ogg Opus는 `audio/ogg`로 저장해 워커에 전달한다. 실제 동영상이나 다른 Ogg 코덱은 거절하며, 첨부 표지 이미지는 허용한다. 플레이 원본 로그 gzip 파일은 기존 20MiB 제한을 유지한다. 원본 multipart 요청은 전체 21MiB 상한을 지키기 위해 길이가 알려져야 하며 길이 미상(chunked 포함)은 411로 거절한다. 브라우저 FormData에서는 길이를 브라우저가 처리한다. 동일 키·정규화된 제목과 아티스트·동일 파일 SHA-256은 기존 작업 상태와 ID를 반환하며 다른 내용은 409, 다른 키의 활성 작업은 429다.

실제 형식과 길이는 `ffprobe`로 검사한다. 운영 이미지에 FFmpeg가 포함되며 로컬에서는 `AUDIO_FFPROBE_PATH`로 실행 파일을 지정할 수 있다. 실행 파일이 없거나 저장소가 설정되지 않으면 503이다. 비공개 비버전 S3 호환 버킷 설정은 `AUDIO_STORAGE_ENABLED`, `AUDIO_STORAGE_ENDPOINT`, `AUDIO_STORAGE_REGION`, `AUDIO_STORAGE_BUCKET`, `AUDIO_STORAGE_ACCESS_KEY`, `AUDIO_STORAGE_SECRET_KEY`, `AUDIO_STORAGE_PRIVATE_BUCKET_CONFIRMED`로 제공한다. 원본 키는 서버에서 생성하며 접수 전에 기록하고 실패·중단된 PUT은 재시도 정리한다. 활성화는 실제 저장소 권한과 버킷의 비공개 설정을 확인한 환경에서만 한다.

V24는 기존 음원과 MIME을 보존하면서 저장 가능한 MIME을 확장한다. 관리자 반주 업로드의 WAV·MP3 제한은 그대로다. 롤백 시 앱을 이전 버전으로 되돌리더라도 확장된 DB 제약과 새 음원 행은 유지한다. 실제 AI 워커의 새 MIME 입력 처리는 별도 통합 검증이 필요하다.

159번은 접수만 구현한다. 워커 처리·진행 조회·분리 모델은 후속 작업이다.

## 개인 곡 관리·커버 (187번)

모든 요청에 Bearer access 토큰이 필요하다. `PATCH /api/v1/songs/{id}`는 `title`·`artist` 중 보낸 문자열만 바꾸며 앞뒤 공백을 제거한다. 제목은 1~100자, 아티스트는 100자 이하이고 빈 아티스트는 null로 지운다. 빈 객체·null·모르는 필드·중복 키·후행 JSON은 400 `SONG_INVALID`다. 성공 응답은 곡 상세와 같다. 처리 중인 곡의 메타 변경과 `DELETE /api/v1/songs/{id}`는 409 `SONG_BUSY`다. 다른 사용자의 곡과 공용 곡 변경은 403 `SONG_FORBIDDEN`, 없는 곡과 삭제된 곡은 404 `SONG_NOT_FOUND`다. 기존 읽기 API는 타인 곡을 계속 404로 처리한다.

`PUT /api/v1/songs/{id}/cover`는 multipart의 `file` 한 개만 받는다. JPEG·PNG·WebP는 실제 바이트와 디코딩으로 검사하며 확장자·MIME을 신뢰하지 않는다. 파일 상한 2MiB, 요청 전체 상한은 2MiB+64KiB, 파트 헤더는 8KiB, 동시 처리 슬롯은 인스턴스당 2개다. 이미지 크기는 가로·세로 각각 4096 이하이면서 전체 400만 픽셀 이하다. 빈 파일·손상·이미지가 아님은 400 `COVER_INVALID`, 다른 이미지 형식은 415 `COVER_UNSUPPORTED`, 크기 초과는 413 `COVER_TOO_LARGE`, 저장소 또는 슬롯 장애는 503 `COVER_UNAVAILABLE`이다. 파일명은 저장 키에 사용하지 않는다. 서버는 이미지 원본을 비공개 저장하므로 메타데이터를 제거하지 않는다. 성공은 200 `{ "coverUrl": "..." }`다. `DELETE /api/v1/songs/{id}/cover`는 없어도 204다. 커버 PUT·DELETE는 처리 중인 곡에도 허용한다.

곡 목록·상세는 기존 필드와 함께 `coverUrl`(없으면 null)과 `sheetId`(248번, 연결된 내 악보 `/api/v1/sheets/{sheetId}`; 없거나 공용 곡이면 null)를 제공한다. 개인 커버만 1시간 서명하며 서명은 저장소에 HEAD를 호출하지 않고 로컬에서 수행한다. URL은 만료 전 재사용 가능하며 저장소 객체의 현재 가용성을 보장하지 않는다. 커버가 없는 곡은 저장소가 비활성이어도 정상 조회된다. 커버는 기존 비공개 악보 버킷의 `cover/{userId}/{songId}/{uuid}.{ext}`에 저장하고, 쓰기·삭제에는 기존 워커의 악보 버킷 쓰기 자격증명(`WORKER_STORAGE_ACCOMPANIMENT_WRITE_ACCESS_KEY`·`WORKER_STORAGE_ACCOMPANIMENT_WRITE_SECRET_KEY`, 미설정 시 음원 저장소 쓰기 키)을 쓴다. 읽기 서명은 기존 chart.assets 읽기 자격증명을 쓴다. 반주·악보 서명 유효 시간은 기존 1~10분 설정을 유지한다.

업로드 전 임시 정리 작업을 등록하고 저장소 작업 뒤 회원·곡 상태를 다시 확인한다. 커버 교체·삭제, 곡 삭제와 탈퇴 시 객체 삭제는 기존 영속 정리 큐가 재시도한다. 곡 삭제는 소프트 삭제이며 채보 버전과 플레이·리포트 참조를 보존한다. 곡 제목의 과거 스냅샷을 새로 만들지 않는다. 현재 리포트 API는 곡 제목을 자체 필드로 반환하지 않으며 이후 곡 상세를 조회하는 화면은 변경된 제목을 볼 수 있다. 운영 저장소의 비공개 설정과 읽기·쓰기·삭제 권한은 배포 환경에서 별도 확인해야 한다.

## 본인 연주 기록 목록 (161번)

`GET /api/v1/plays`는 활성 Bearer 인증 회원의 기록을 종료 시각·playId 기준으로 반환한다. 선택 파라미터 `sort=NEWEST|OLDEST`(기본 NEWEST)는 두 기준에 같은 방향을 적용한다. `mode=FREE|RHYTHM|SHEET|TEMPO`는 해당 모드만 조회한다. `q`는 앞뒤 공백을 제거한 100자 이하 곡 제목 부분 검색으로 대소문자를 구분하지 않고 `%`, `_`, `!`는 문자 그대로다. 빈 검색어는 전체 조회이며 접근 가능한 곡 제목만 검색하므로 접근 불가 곡과 곡 없는 모드는 검색 결과에서 제외된다. `from`, `to`는 `YYYY-MM-DD` 형식의 한국 시간 종료일 범위이며 양 끝 날짜를 포함하고 각각 생략할 수 있다. 시작일이 종료일보다 늦거나 잘못된 필터는 400이다. `page`는 0~100000(기본 0), `size`는 1~100(기본 20)이며 응답은 `items`, `page`, `size`, `totalElements`, `totalPages`, `hasNext`다. 범위를 벗어난 페이지는 빈 배열이며 전체 0건이면 totalPages는 0이다. 인증 실패는 401, 잘못된 페이지 입력은 400이고 서비스 직접 호출에도 같은 범위 검증을 적용한다. 응답은 `Cache-Control: no-cache, no-store`를 포함한다. offset 페이지 조회 도중 기록이 추가·삭제되면 페이지 간 중복이나 누락이 생길 수 있다.

각 항목은 `playId`, `startedAt`, `endedAt`, `mode`, `inputSource`, `songId`, `songTitle`, `chartVersionId`, `chartId`, `difficulty`, `endReason`, `songAccessible`, `score`, `accuracy`, `maxCombo`, `hasReport`를 제공한다. `chartId`는 고정 버전이 속한 연습 단계이며 참조가 없으면 null이다. `endReason`은 `COMPLETED`, `ABORTED`, `DISCONNECTED` 또는 미기록을 뜻하는 null이다. 종료 사유와 관계없이 목록에 유지한다. accuracy는 0~100 백분율이므로 0~1 비율이 필요한 화면은 100으로 나눈다. FREE/TEMPO의 곡·채보·점수 정보는 null이다. `songAccessible`은 현재 곡 조회 조건을 뜻하며 공용 곡은 READY와 published, 개인 곡은 본인 소유여야 한다. 삭제됐거나 참조가 없으면 false이고, 재생 가능성까지 보장하지 않는다. 접근할 수 없는 곡의 현재 제목은 null이지만 과거 곡·고정 채보 ID는 유지한다.

`hasReport`는 RHYTHM/SHEET 기록에 리포트가 존재하는지를 뜻하며 AI 코칭 상태와 무관하다. 리포트가 없어도 과거 기록은 목록에 남는다. 곡 제목이 없을 때의 대체 문구와 날짜 표시 형식은 FE에서 별도로 정한다. FE는 true인 항목에서 `/result/{playId}/report`로 이동할 수 있으며 데이터는 기존 `/api/v1/plays/{playId}/report`와 `/notes`에서 조회한다.

## 곡·연습 단계별 최고 기록 (268번)

`GET /api/v1/plays/best-records?songIds=1,2`는 활성 Bearer 인증 회원의 기록만 조회한다. `songIds`는 양의 64비트 정수 1~100개를 쉼표로 구분한 필수 값이다. 중복 제거 전 100개를 초과하거나 빈 항목·잘못된 값이 있으면 400이다. 중복은 제거한다. 접근 불가·삭제·없는 곡과 기록 없는 곡은 결과에서 생략하며 구분하지 않는다.

응답은 `items` 배열이다. 각 항목은 `songId`, `chartId`, `difficulty`, `mode`, `bestScore`, `bestAccuracy`이며 곡·채보·모드 오름차순이다. `RHYTHM`과 `SHEET`를 구분하고 같은 연습 단계의 여러 채보 버전을 함께 집계한다. 1배속(미기록 포함)의 `COMPLETED`만 포함하며 `ABORTED`, `DISCONNECTED`, 종료 사유 미기록(null)은 제외한다. 점수와 정확도의 최댓값은 독립적이므로 서로 다른 플레이에서 나올 수 있다. 값이 0인 기록은 반환하며 기록이 없는 경우 항목이 없다. 해당 집계값이 모두 null인 과거 행은 null로 반환한다.

곡 선택 화면은 모드에 맞는 전체 단계 중 최고 점수 또는 정확도를 선택하고 연주 준비 화면은 선택한 `chartId`를 쓴다. `bestAccuracy`는 0~100이므로 FE의 0~1 비율로 쓰려면 100으로 나눈다. 이 API 제공은 FE 연동 완료를 뜻하지 않는다.

## MIDI 업로드 → 채보 변환 (151번)

CHART-002. 사용자가 올린 표준 MIDI 파일의 드럼 노트를 요청 안에서 채보 3난이도로 바꿔 **내 곡**(`source=MIDI`)으로 저장한다.
채보는 계속 동기로 생성한다. 원본은 전용 비공개 버킷에 보관하고 다른 악기 노트가 있으면 별도 CPU 워커가 반주를 비동기 생성한다(V31).
원본 보관과 곡·채보·필요한 작업 등록이 끝나야 201이다. 반주 합성 실패는 곡·채보 사용을 막지 않는다.

`POST /api/v1/songs/midi`: Bearer 인증, multipart `file`(1 MiB 이하) 1개, `title`(앞뒤 공백 제거 후 1~100자) 1개, 선택 `artist`(0~100자, 빈 값은 null).
다른 필드나 같은 필드 여러 개는 400이다. 성공은 `201 Created`, `Location: /api/v1/songs/{songId}`, 본문은 `GET /api/v1/songs/{songId}`와 같은 곡 상세다.
같은 파일을 다시 올리면 새 곡이 하나 더 생긴다(멱등 키 없음).

| 상태 | `code` | 경우 |
| --- | --- | --- |
| 400 | `MIDI_INVALID` | 요청 형태 위반, 제목 없음·100자 초과, 빈 파일 |
| 401 | `UNAUTHORIZED` | 토큰 없음·무효, ACTIVE가 아닌 회원 |
| 413 | `MIDI_TOO_LARGE` | 파일 1 MiB 초과(선언 크기를 믿지 않고 읽은 바이트로도 확인) |
| 422 | `MIDI_UNSUPPORTED` | MIDI 아님·손상, format 2, SMPTE 시간 단위, 템포 1~999 BPM 밖, 5자 넘는 박자표, 곡 길이 30분 초과, 드럼 노트 50,000개 초과. detail에 이유 한 줄 |
| 422 | `MIDI_NO_DRUM_NOTES` | 드럼 채널(10)에 패드로 바꿀 노트가 없음 |
| 503 | `MIDI_STORAGE_UNAVAILABLE` | 원본 저장소 미설정·저장/확인 실패·접수 시간 초과 |
| 500 | `INTERNAL_ERROR` | 저장 실패. 곡·채보 행을 하나도 남기지 않는다 |

변환 규칙:

- JDK `javax.sound.midi`로 파일만 읽는다(소리 장치·외부 라이브러리 없음). format 0·1, PPQ 분해능만 받는다.
- GM 규격대로 **채널 10의 note-on(velocity > 0)** 만 드럼으로 본다. 다른 채널은 무시한다.
- GM 피치 → 패드는 AI 파트 `gmd.py`의 표와 맞추되 44(페달 하이햇)는 `HIHAT_PEDAL`로 따로 저장한다.

| 패드 | GM 피치 |
| --- | --- |
| `KICK` | 35, 36 |
| `SNARE` | 37, 38, 40 |
| `HIHAT` | 22, 26, 42, 46 |
| `HIHAT_PEDAL` | 44 |
| `SMALL_TOM` | 48, 50 |
| `MID_TOM` | 45, 47 |
| `FLOOR_TOM` | 41, 43, 58 |
| `CRASH` | 49, 52, 55, 57 |
| `RIDE` | 51, 53, 59 |
| 제외 | 그 밖의 피치(클랩·탬버린·카우벨 등) |

- 같은 (tick, 패드)는 세기가 큰 노트 하나로 합친다. 난이도 규칙(`generator_version=midi-rule-2.0`, 328번에서 EASY만 바뀜):

| 규칙 | HARD | NORMAL | EASY |
| --- | --- | --- | --- |
| 패드 | 전체 | 전체 | `HIHAT_PEDAL` 제외 |
| 격자(±32분음표 절반 허용) | 없음 | `HIHAT`·`HIHAT_PEDAL`·`RIDE`는 8분 격자만 | 모든 패드 EASY 박 위만(연타 구간은 아래) |
| 고스트(세기 40 미만) | 유지 | 스네어만 제외 | 유지(세기로 거르지 않음) |
| 같은 시각 상한 | 없음 | 2개 | 2개 |
| 최소 간격(이보다 가까우면 충돌) | 없음 | 16분의 3/4 | 225ms |

  상한·간격 충돌에서는 `SNARE > KICK > CRASH > HIHAT > RIDE > SMALL_TOM > MID_TOM > FLOOR_TOM > HIHAT_PEDAL`, 같으면 세기가 큰 쪽(같으면 먼저 친 쪽)을 남긴다.
  EASY가 비면 NORMAL을, NORMAL이 비면 HARD를 그대로 쓴다. 규칙을 바꾸면 버전을 올린다.

  EASY는 곡 템포를 본다(`DifficultyThinner`, 상수 `T_MIN_MS` 300ms·`BURST_RUN` 3).
  - **EASY 박:** 그 tick의 템포에서 길이가 300ms 이상인 가장 짧은 음표. 100 BPM 이하는 8분, 200 BPM 이하는 4분, 그보다 빠르면 2분. 격자는 tick 0부터 센다.
  - **연타 구간:** 앞뒤 간격이 300ms보다 짧게 3묶음 이상 이어지는 줄. 구간 안의 EASY 박마다 박 앞뒤 반 칸에서 박에 가장 가까운 묶음 하나를 남긴다(같으면 우선순위). 연타가 아닌 묶음은 EASY 박 위일 때만 남는다.
  - 템포는 MIDI 템포 이벤트(첫 이벤트 전은 120 BPM)를 쓴다. 남는 노트는 모두 HARD 원본이며 옮기거나 새로 만들지 않는다.
  - 느린 곡은 EASY가 8분까지 남아 NORMAL과 같아질 수 있고, 고스트가 많은 느린 곡은 EASY 노트가 NORMAL보다 많을 수 있다.
- 템포·박자표가 없으면 MIDI 기본값 120 BPM·4/4를 tick 0에 넣는다. BPM은 소수 둘째 자리로 반올림하고 그 값으로 `timeMs`(정수, 업로드는 `offsetMs=0`, 공용 곡 카탈로그는 254번 절의 `offsetMs`)를
  `ChartDocumentReader.milliseconds`와 같은 식으로 계산한다. 그래서 악보 페이지 ms와 노트 시각이 어긋나지 않는다.
- `notation`은 tick·note-off까지 길이(없으면 16분음표)·voice(`KICK`·`HIHAT_PEDAL` 2, 나머지 1), `timing`에는 `ppq`·`tempoMap`·`timeSignatureMap`을 항상 넣는다.
  저장 전에 조회 리더로 다시 읽어 검증한다.
- 곡 `duration_ms`는 마지막 노트에서 한 마디 뒤와 시퀀스 길이 중 긴 쪽이다. `songs.bpm`·`time_signature`는 첫 템포·박자표다.
- 채보 버전은 난이도마다 version 1, `notation_status=PENDING`, `sheet_pages=NULL`이다. 악보 이미지는 FE가 채보 데이터로 그려 별도 API(155번)로 올린다.

FE 리듬게임 레인(`LANE_PADS`)은 아직 `HIHAT_PEDAL`을 그리지 않는다. 조회 응답에는 포함되므로 FE가 레인 표시 여부를 정한다.

```powershell
.\gradlew.bat test --tests '*Midi*' --tests '*GmDrumMappingTest' --tests '*DifficultyThinnerTest'
```

테스트용 MIDI는 `MidiFixtures`가 JDK API로 만든다. 외부 MIDI 파일은 저장소에 넣지 않는다. 노트 JSON은 저장 전 조회 리더로 검증하며, 난이도별 출력과 로케일별 노트 ID를 기존 직렬화 결과와 비교한다.

### MIDI 반주 합성 및 운영 (274번)

곡 목록·상세 및 업로드 상세의 `accompanimentStatus`는 `GENERATING`·`READY`·`FAILED`·`NONE`이다. 기존 반주 키가 있으면 재합성 중이거나 실패해도 `READY`와 `hasAccompaniment=true`다. 키가 없는 MIDI의 최신 작업이 대기·진행 중이면 `GENERATING`, 최종 실패면 `FAILED`, 드럼 외 note-on이 없거나 기존 원본 없는 곡은 `NONE`이다. AUDIO·BUILTIN도 키 유무에 따라 `READY` 또는 `NONE`을 반환한다. 반주가 없을 때 기존 곡별 조회의 URL·만료 시각은 모두 null이다.

원본 `midi-original/{userId}/{songId}/{uuid}.mid`는 비공개 비버전 `airdrum-midi-originals`에 보관한다. `MIDI_STORAGE_ENABLED`, `MIDI_STORAGE_ENDPOINT`, `MIDI_STORAGE_REGION`, `MIDI_STORAGE_BUCKET`, `MIDI_STORAGE_ACCESS_KEY`, `MIDI_STORAGE_SECRET_KEY`, `MIDI_STORAGE_PRIVATE_BUCKET_CONFIRMED`를 설정한다. 기본 비활성이고 비공개 버킷 확인 없이 활성화하지 않는다. 원본 접수는 조건부 PUT·HEAD·원본 GET 해시 확인에 합계 5초, 접수 임대에 30초를 사용하며 실패 시 503이다. 삭제·탈퇴 시 원본과 반주를 정리하고 지연 PUT은 마지막 쓰기 가능 시점 이후 24시간 동안 재확인한다. 그보다 늦게 완료되는 저장소 쓰기는 지원 범위 밖이다.

독립 `midi-worker.jar`는 1작업씩 2초마다 큐를 확인한다. 임대 60초, 갱신 10초, 시도 전체 300초, 최대 3회(5초·30초 대기), 대기 최대 24시간이다. 작업당 임시 공간 1GiB와 결과 384MiB를 제한한다. 고정 템포 MIDI의 이벤트를 채보 시간에 0.1ms 간격으로 배치하고, FluidSynth가 채널 10을 제외한 파트를 합성한다. 출력은 시작 무음을 유지한 FLAC 16bit·44.1kHz·스테레오이며 끝부분만 잘라내거나 무음으로 채워 샘플 수를 맞춘다. 재합성 성공은 새 키로 교체하고 기존 키는 최대 서명 URL 10분과 다운로드 여유 2분이 지난 뒤 정리한다. 이미 발급된 URL의 전체 재생 완료를 보장하지는 않는다.

합성·인코딩 프로세스가 0이 아닌 코드로 끝나거나 입력·출력 검증에 실패하면 영구 실패로 처리한다. 임대·시간 초과와 저장소 등 일시 I/O 장애는 남은 횟수 안에서 재시도한다.

빌드는 `./gradlew bootJar bootMidiWorkerJar`다. `Infra/docker-compose.yml`의 `midi-worker` profile은 CPU 1개·메모리 2GiB·1GiB tmpfs를 사용한다. 원본·반주 저장소와 별도 DB 계정의 최소 권한을 운영에서 확인한 뒤 활성화한다. 스토리지 계정에는 원본 읽기와 반주 쓰기·확인만 부여한다. 환경 변수 `MIDI_WORKER_DB_USERNAME`, `MIDI_WORKER_DB_PASSWORD`, `MIDI_WORKER_STORAGE_ACCESS_KEY`, `MIDI_WORKER_STORAGE_SECRET_KEY`는 운영 비밀 관리 경로로 주입한다.

DB 계정은 다음 권한이 필요하다. `users`의 SHARE 잠금과 `midi_original_uploads`의 UPDATE 잠금에도 해당 테이블의 UPDATE 권한이 필요하므로 예시에서는 `id` 열에만 부여한다. 계정명 `midi_worker`는 예시이며 서버 관리자가 실제 계정을 별도로 만든다. 다음 SQL은 자동 실행하지 않는다.

```sql
GRANT SELECT ON users, songs, midi_original_uploads, midi_accompaniment_jobs,
  midi_accompaniment_attempts, file_cleanup_tasks, charts, chart_versions TO midi_worker;
GRANT UPDATE (id) ON users, midi_original_uploads TO midi_worker;
GRANT UPDATE (accompaniment_key, updated_at) ON songs TO midi_worker;
GRANT INSERT, UPDATE ON midi_accompaniment_jobs TO midi_worker;
GRANT INSERT ON midi_accompaniment_attempts TO midi_worker;
GRANT INSERT, UPDATE ON file_cleanup_tasks TO midi_worker;
GRANT USAGE, SELECT ON SEQUENCE midi_accompaniment_jobs_id_seq, file_cleanup_tasks_id_seq TO midi_worker;
```

운영 재합성은 실행 이미지를 같은 설정으로 띄워 `--resynthesize songId [songId ...]`를 실행하면 dry-run이고, `--resynthesize --apply songId [songId ...]`에서만 지정한 곡을 큐에 넣는다. 원본 무결성·회원·곡·드럼 외 노트와 활성 작업을 확인한다. 사용자는 `POST /api/v1/songs/{songId}/accompaniment/retry`로 본인 MIDI 반주의 최종 실패를 재시도할 수 있다. 본문 없이 Bearer 인증을 사용하며 등록 성공은 빈 202다. 키가 없고 최신 합성 작업이 FAILED이며 ACCEPTED 원본·최신 HARD timing·드럼 외 노트가 있어야 한다. 큐 등록 뒤 목록·상세의 `accompanimentStatus`를 확인한다. 타인·삭제 곡은 404 `SONG_NOT_FOUND`, 대상이 아니거나 중복 요청이면 409 `MIDI_RETRY_UNAVAILABLE`, 저장소 장애는 503 `MIDI_STORAGE_UNAVAILABLE`이다. 기존 반주 교체와 AUDIO 재시도는 지원하지 않는다.

워커 이미지는 Ubuntu Jammy의 [FluidSynth 2.2.5-1](https://packages.ubuntu.com/jammy/fluidsynth), [FluidR3 GM 3.1-5.3](https://packages.ubuntu.com/source/jammy/fluid-soundfont), [FFmpeg 7:4.4.2-0ubuntu0.22.04.1](https://packages.ubuntu.com/jammy-updates/ffmpeg)을 사용하며 SoundFont SHA-256 `74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0`를 빌드·시작 시 확인한다. FluidSynth는 LGPL, FluidR3 GM은 MIT이며 이미지에 패키지 저작권 고지가 포함된다. 로컬 2.4.6 실측을 운영 2.2.5의 성능 보장으로 해석하지 않는다.

CI 렌더 검사는 일반 사용자로 Ubuntu 패키지를 작업 디렉터리에 검증·추출해 FluidSynth 2.2.5를 실행한다. FFmpeg·ffprobe는 기존 SHA-256 고정 준비 스크립트의 8.1.3을 사용하므로 워커 이미지의 FFmpeg 4.4.2 실행 검증과 구분한다.


## MusicXML 업로드 → 채보 변환 (293번)

CHART-001. 사용자가 올린 **드럼 MusicXML**(`.musicxml`·`.xml`·`.mxl`)을 AI 서버가 채보 JSON으로 바꾸고, BE가 음원 채보와 같은 규칙으로 HARD·NORMAL·EASY를 만들어
**내 곡**(`source=MUSICXML`)으로 저장한다. MIDI 업로드(151번)처럼 요청 안에서 끝나는 동기 API다. 이미지·PDF 악보 인식은 넣지 않는다(AI 측정: 악기 정확도 평균 0.49,
곡당 크레딧 약 6,600).

`POST /api/v1/songs/musicxml`: Bearer 인증, multipart `file`(5 MiB 이하) 1개, `title`(앞뒤 공백 제거 후 1~100자) 1개, 선택 `artist`(0~100자, 빈 값은 null).
다른 필드나 같은 필드 여러 개는 400이다. 성공은 `201 Created`, `Location: /api/v1/songs/{songId}`, `Cache-Control: private, no-store`, 본문은 곡 상세
(`status=READY`, `hasAccompaniment=false`, `accompanimentStatus=NONE`). 채보는 세 난이도를 모두 저장하지만 응답의 `difficulties`·`charts[]`는 260번 숨김 규칙을 따르므로
노트 수가 NORMAL과 같은 HARD·EASY는 빠져 1~3개다. 같은 파일을 다시 올리면 새 곡이 하나 더 생긴다(멱등 키 없음).

흐름: 바이트 검사(`MusicXmlSniffer`: XML은 BOM·공백 뒤 `<`로 시작하고 앞 4 KiB 안에 `<score-partwise`/`<score-timewise`, mxl은 zip 머리 + `META-INF/container.xml`.
확장자·Content-Type은 보지 않는다. UTF-16으로 저장된 XML은 `<`로 시작하지 않아 422다) → AI 서버 `POST {AI_ANALYSIS_BASE_URL}/chart/sheet?name=score.musicxml|score.mxl`에 파일 바이트를 그대로 보냄
(`MusicXmlConvertClient`, 연결 1초·전체 10초·응답 5 MiB) → 응답 `chart`를 음원 워커 결과와 같은 검증·3난이도 파생(`domain.chart.service.generation.TranscriptionCharts`,
`WorkerResults`에서 꺼낸 공용 클래스) → 한 트랜잭션에 곡 1 + 채보 3 + 버전 3, 곡 난이도 산정. AI 호출 전에는 DB를 건드리지 않으므로 거절·장애 때 곡 행이 남지 않는다.

저장: `songs.bpm`·`offset_ms`(못갖춘마디 길이)·`time_signature`는 AI `timing`, `duration_ms`는 AI `sheet.duration_ms`. `chart_versions`는 HARD = AI 원본
(`generator_version` `sheet-musicxml-3`), NORMAL·EASY = `midi-rule-2.0` 솎기(`…+midi-rule-2.0`), `generator=MUSICXML_RULE`(V46), `notation_status=UNAVAILABLE`
(악보 표기는 없고 FE 악보 격자는 `offsetMs`·`bpm`로 그린다). `hihatOpen` 필드는 노트 JSON에 그대로 남는다. 원본 MusicXML은 보관하지 않는다(반주 스프린트에서 다시 정한다).

| 상태 | `code` | 경우 |
| --- | --- | --- |
| 400 | `MUSICXML_INVALID` | 요청 형태 위반, 제목 없음·100자 초과, 빈 파일 |
| 401 | `UNAUTHORIZED` | 토큰 없음·무효, ACTIVE가 아닌 회원 |
| 413 | `MUSICXML_TOO_LARGE` | 파일 5 MiB 초과(선언 크기를 믿지 않고 읽은 바이트로도 확인) |
| 422 | `MUSICXML_UNSUPPORTED` | MusicXML 아님(바이트 검사), AI `INPUT_INVALID`(timewise·깨진 XML/zip·파트 없음·반복을 펼친 길이 30분 초과). detail에 AI 메시지 한 줄 |
| 422 | `MUSICXML_NO_DRUM_NOTES` | 드럼 파트가 없거나 패드로 바꿀 음표가 없음(AI `NO_DRUM_NOTES`) |
| 503 | `MUSICXML_UNAVAILABLE` | AI 서버 연결 불가·10초 초과·5xx·응답 5 MiB 초과·계약 밖 응답(채보 검증 실패 포함) |
| 500 | `INTERNAL_ERROR` | DB 저장 실패. 곡·채보 행을 하나도 남기지 않는다 |

로그: 악보 본문·사용자 파일 이름·AI 응답 본문은 남기지 않는다. 클라이언트는 AI 상태 코드와 예외 종류만 WARN으로 남기고, 422 `MUSICXML_UNSUPPORTED`의 detail(AI 메시지 한 줄)은
공통 예외 처리기 WARN 로그에 포함된다. 503은 공통 정책대로 ERROR 스택트레이스다.

**배포 순서:** `ai-api`에 `/chart/sheet`가 먼저 떠 있어야 한다(없으면 모두 503). nginx는 `/api/v1/songs/musicxml`의 본문 상한(`client_max_body_size 6m`)을 열어야
1 MB 넘는 악보가 BE에 닿는다(Infra 요청). FE 업로드 폼은 마지막이다. AI 쪽 계약·설정(`configs/chart/sheet.yaml`)은 AI README 「드럼 악보 → 채보」 절.

```powershell
.\gradlew.bat test --tests '*MusicXml*' --tests '*TranscriptionChartsTest'
```

`MusicXmlSnifferTest`(바이트 검사·오류 코드), `MusicXmlConvertClientTest`(가짜 AI 서버로 상태별 분기·시간 초과·크기 초과·연결 실패), `MusicXmlSchemaTest`(V46 CHECK),
`MusicXmlUploadApiTest`(실제 JWT·임베디드 PG·가짜 AI 서버: 201·3난이도 저장·mxl·400/413/422/503·롤백), `TranscriptionChartsTest`(검증·파생 규칙).

## 공용 곡 관리 (156번)

CHART-001. 운영자(ADMIN)가 공용 곡(`source=BUILTIN`, 소유자 없음)을 MIDI로 등록하고 정보·채보·커버·반주를 고치며 공개 여부를 바꾼다.
모든 경로는 `/api/v1/admin/songs`이고 Bearer 인증 + **ADMIN 역할**(`@PreAuthorize`)이 필요하다. 미인증·탈퇴 401, USER 403 `FORBIDDEN`.
없는 곡·삭제된 곡·**개인 곡 ID**는 404 `SONG_NOT_FOUND`다(ADMIN도 개인 곡을 다루지 않는다). 응답은 `Cache-Control: private, no-store`. FE 관리 화면은 ADMIN에게만 보이는 「공용 곡 관리」(`/admin/songs`, 262번: 공용 곡 추가·반주 올리기)이고, 그 밖의 동작은 Swagger의 `Admin Songs` 묶음으로 호출한다(운영은 Swagger 꺼짐).

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `POST /midi` | multipart `file`(MIDI ≤ 1 MiB), `title` 1~100자, 선택 `artist` 0~100자, `license` 1~200자 **필수**, 선택 `published` `true`(기본)/`false`, 선택 `offsetMs` 0~1,800,000 정수(기본 0, 262번. 첫 마디 첫 박 시각 ms로 카탈로그 260번과 같은 규칙. 부호·공백·소수는 400 `SONG_INVALID`, 첫 박보다 앞선 노트는 422 `MIDI_UNSUPPORTED`) | 201, `Location: /api/v1/admin/songs/{id}`, 관리자 곡 상세 |
| `GET /` | `published`(생략 시 전체), `q`, `page`, `size`(곡 목록과 같은 범위) | 비공개 포함 목록, 삭제 곡 제외, 생성 내림차순 |
| `GET /{id}` | — | 관리자 곡 상세 |
| `PATCH /{id}` | JSON `title`·`artist`·`license`·`published` 중 1개 이상. 빈 `artist`는 null | 관리자 곡 상세 |
| `PUT /{id}/charts/midi` | multipart `file`, 선택 `offsetMs`(생략하면 곡의 기존 값) | 난이도별 새 버전이 반영된 상세 |
| `PUT /{id}/cover`, `DELETE /{id}/cover` | 187번 커버와 같은 이미지 규칙 | `{coverUrl}` / 204 |
| `PUT /{id}/accompaniment`, `DELETE /{id}/accompaniment` | multipart `file` WAV·MP3, 50 MiB·10분 이하 | `{accompanimentUrl, expiresAt}` / 204 |
| `DELETE /{id}` | — | 204, 소프트 삭제 |

관리자 곡 상세는 곡 상세의 메타데이터에 `license`, `published`, `hasCover`, `updatedAt`, 난이도별 최신 버전의 `generator`·`generatorVersion`·`createdAt`을 더한다. `source`는 항상 BUILTIN이라 넣지 않는다. 255번부터 상세에만 곡 추천용 `metadata`(아래 공용 곡 카탈로그의 `meta`와 같은 필드, 없으면 null)를 더한다. 목록·회원용 곡 응답에는 없고, ADMIN API로 고치는 기능은 두지 않는다(카탈로그가 유일한 출처).

- **공개 여부:** V22 `songs.published`. 비공개 공용 곡은 일반 사용자의 곡 목록·상세·채보·assets에서 없는 곡(404)이다(`SongRepository.VISIBLE`·`FILTER`). 개인 곡은 CHECK로 항상 true라 의미가 없다. 비공개로 바꾸기 전에 받아 둔 `chartVersionId`로 진행 중이던 플레이 결과는 저장된다(새 플레이는 조회가 막혀 시작할 수 없다).
- **등록·채보 수정:** 151번 변환기(`MidiChartConverter`, `midi-rule-2.0`)를 그대로 쓴다. 채보는 `generator=MIDI_RULE`, `notation_status=PENDING`. MIDI를 다시 올리면 난이도별 `version = 최대 + 1` 행을 추가하고 기존 버전·플레이 기록은 그대로 둔다. 빠진 난이도는 version 1로 채운다. 곡의 `bpm`·`time_signature`·`duration_ms`는 새 MIDI 값으로 바뀌지만 버전별 `timing`은 그대로라 과거 버전의 시간 기준은 바뀌지 않는다.
- **커버:** 키 `cover/builtin/{songId}/{uuid}.{jpg|png|webp}`(악보 버킷). 공개된 공용 곡 커버는 모든 회원의 곡 목록·상세 `coverUrl`에 1시간 서명으로 온다.
- **반주:** ffprobe(`AudioProbe`)로 실제 바이트를 검사한다. 키 `accompaniment/{songId}/{uuid}.{wav|mp3}`(반주 버킷), 같은 키에 덮어쓰지 않고 교체마다 새 키를 만든다. 쓰기는 워커의 반주 버킷 쓰기 자격증명을 쓰므로 운영 자격증명에 PutObject 권한이 있어야 한다. 82번 도구가 등록한 `accompaniment/{songId}.wav`도 그대로 재생된다.
- **정리:** 커버·반주 업로드 전에 임시 정리 작업(`user_id` NULL, 5분 뒤)을 등록하고 저장소 쓰기 뒤 곡을 다시 잠가 연결한다. 교체·삭제·곡 삭제 때 이전 객체는 기존 정리 큐가 지운다. 정리 큐는 살아 있는 공용 곡이 참조하는 커버·반주를 지우지 않는다.

| 상태 | `code` | 경우 |
| --- | --- | --- |
| 400 | `SONG_INVALID` | 제목·아티스트·라이선스·`published` 형식, 모르는 필드, PATCH 본문 규칙 위반 |
| 400·413·422 | `MIDI_*` | 151번과 같음 |
| 400·413·415·503 | `COVER_*` | 187번과 같음 |
| 400 | `ACCOMPANIMENT_INVALID` | 파일 없음·빈 파일·필드 형태 위반 |
| 413 | `ACCOMPANIMENT_TOO_LARGE` | 50 MiB 초과 |
| 422 | `ACCOMPANIMENT_UNSUPPORTED` | WAV·MP3가 아니거나 10분 초과 |
| 503 | `ACCOMPANIMENT_UNAVAILABLE` | 저장소 비활성·쓰기 실패, ffprobe 실행 불가 |

```powershell
.\gradlew.bat test --tests '*AdminSong*' --tests '*BuiltinSong*' --tests '*SongPublishedVisibilityTest'
```

## 공용 곡 카탈로그 (254번)

CHART-001. 공용 곡(기본 곡)을 저장소의 카탈로그로 관리하고 **앱이 켜질 때 자동으로 등록**한다. 배포만 하면 로컬·dev·운영에 같은 공용 곡이 들어가며, 사람이 ADMIN API를 호출할 필요가 없다.

- **카탈로그:** `src/main/resources/builtin-songs/catalog.json`(배열)과 `builtin-songs/midi/*.mid`. 항목은 `title`(1~100자, 같은 곡 판별 키라 바꾸지 않는다)·`artist`(선택)·`license`(필수, 출처와 이용 조건. 명세 17장은 자작·CC0·퍼블릭 도메인을 전제했으나, 2026-11-05 팀 결정으로 AI가 채보한 상업 곡도 `원곡 {아티스트}, 드럼 채보 AI 팀 제작, 비상업 프로젝트 내부 시연용` 형식으로 넣는다)·`midi`(파일 이름)·`published`(선택, 기본 true)·`offsetMs`(선택, 기본 0, 아래 기준점)·`meta`(선택, 아래 곡 추천 메타데이터)·`lesson`(선택, 아래 입문 코스). 모르는 필드·제목 중복·필수 누락·MIDI 없음·`meta`·`lesson` 규칙 위반이 하나라도 있으면 카탈로그 전체를 거부하고 아무것도 등록하지 않는다.
- **등록 규칙(`domain.song.service.admin.BuiltinSongSeeder`):** 살아 있는 공용 곡 중 제목이 같은 곡이 없으면 156번 등록과 같이 MIDI → 3난이도로 등록한다. 있고 난이도가 3개 미만이면 156번 채보 수정과 같이 새 버전을 만들어 채운다(있던 난이도는 version+1, 빠진 난이도는 version 1, 기존 버전 행은 남음). 이미 3난이도면 건너뛴다. 라이선스·아티스트·공개 여부는 등록 때만 쓰고 이후에는 덮지 않는다(ADMIN PATCH 값을 지킴). 지운 공용 곡·개인 곡과 제목이 같아도 새 공용 곡으로 등록한다. 곡 난이도 등급(V29)도 등록·갱신 때 함께 계산된다.
- **기준점 `offsetMs`(260번):** AI가 주는 MIDI는 0틱 = 원본 음원 0초라 첫 박이 0틱이 아니다. `offsetMs`(0 이상 1,800,000 이하 정수, 원본 음원 0초 기준 **첫 마디 첫 박** 시각 ms, 음원 없는 곡은 0)를 주면 변환기가 템포 맵으로 첫 박 tick을 역산해 노트·템포·박자표·길이 tick에서 뺀다. 첫 박에 걸린 템포·박자표는 0틱에 둔다. 그 위에서 솎기 격자가 첫 박부터 서고, `notation.tick` 0 = 첫 박, `timing.offsetMs`·`songs.offset_ms` = 카탈로그 값, `timeMs` = `offsetMs` + tick의 ms(원본 MIDI 시각과 1ms 안에서 같음), `duration_ms`도 음원 0초부터다. 음원 채보(`WorkerResults`, `timeMs - offsetMs`로 tick)와 같은 표현이다. 첫 박보다 32분음표 절반(`ppq/8`)을 넘게 앞선 노트가 있으면 그 곡은 `MIDI_UNSUPPORTED`로 등록 실패다(못갖춘마디 곡은 그 마디의 시작 시각을 `offsetMs`로 준다). 그 안쪽은 0틱으로 본다. 저장소 카탈로그 전체를 각자의 `offsetMs`로 변환하는 테스트(`BuiltinSongSeederTest.저장소의_카탈로그는_모든_곡이_3난이도로_변환된다`)가 있어 이런 곡을 넣으면 전체 검사 CI가 실패한다. 이미 3난이도인 곡은 `offsetMs`를 바꿔도 다시 만들지 않는다(다른 필드와 같다). 156번 ADMIN MIDI 재업로드(`PUT /{id}/charts/midi`)는 `offsetMs`를 생략하면 곡에 저장된 값을 그대로 쓴다(328번). 카탈로그 곡을 같은 MIDI로 다시 만들 때(예: 솎기 규칙 변경 뒤)는 생략하고, 첫 박이 다른 MIDI로 바꿀 때만 준다. 등록과 같은 형식 검사(400 `SONG_INVALID`)와 첫 박보다 앞선 노트 검사(422 `MIDI_UNSUPPORTED`)를 한다. 카탈로그의 `offsetMs` 자체를 바꾸면 3난이도 곡은 시작 시 건너뛰므로 이 API로 새 값을 주어 다시 만든다. 274번 MIDI 반주 합성은 사용자 MIDI 곡(`offsetMs` 0)만 대상이다.
- **실패:** 곡마다 따로 처리해 MIDI 변환 실패 등은 warn 로그(`공용 곡 등록 실패: {제목}`)만 남기고 다음 곡으로 간다. 어떤 실패도 앱 시작을 막지 않는다. 결과는 info 로그 `공용 곡 카탈로그 결과 N곡: {REGISTERED=…, FILLED=…, SKIPPED=…, FAILED=…}`로 확인한다.
- **동시 시작:** PostgreSQL advisory lock(키 254001)을 잡은 인스턴스만 실행한다.
- **설정:** `builtin-songs.seed.enabled`(기본 true, 테스트 기본 false), `builtin-songs.location`(기본 `classpath:builtin-songs/`).
- **시드 3곡:** V10의 「기본 8비트」·「8비트 + 필인」·「라이드 16비트」는 난이도가 1개씩이라, 같은 패턴을 MIDI로 옮겨(`scripts/seed_midi_from_v10.py`, 1회용·재현용) 카탈로그에 넣었다. 첫 시작 때 3난이도로 채워진다. 「기본 8비트」 EASY 최신 버전은 전체 패턴(96노트)에서 솎은 패턴으로 바뀐다(기존 버전과 플레이 기록은 그대로). MIDI 변환기가 마지막 노트 뒤에 한 마디를 붙이는 규칙(사용자 MIDI 곡과 같음) 때문에 곡 길이(`songs.duration_ms`)가 한 마디 늘어난다: 「기본 8비트」 21333→23667, 「8비트 + 필인」 19200→21300, 「라이드 16비트」 16000→17875 ms. 82번 반주 도구(`registerBasic8Backing`)는 「기본 8비트」의 채보가 V10 원본 그대로(EASY 하나, 버전 1개, 96노트)일 때만 동작하므로 **이 등록 뒤에는 거부된다**. 82번 반주를 아직 연결하지 않은 환경이라면 이 변경을 배포하기 전에 82번 도구를 먼저 실행하거나, 이후에는 156번 `PUT /api/v1/admin/songs/{id}/accompaniment`로 반주를 올린다.
- **운영 주의:** 카탈로그에 있는 곡은 ADMIN으로 지우거나 제목을 바꿔도 다음 앱 시작 때 카탈로그 제목으로 다시 등록된다. 공용 곡을 없애려면 카탈로그에서 빼서 배포한 뒤 ADMIN으로 지운다.
- **AI 공용 곡 31곡(261번):** AI(245번)가 드럼리스 음원에 맞춰 만든 MIDI 31곡(type 1·PPQ 480·10번 채널)을 AI가 준 곡별 첫 박 시각을 `offsetMs`로 넣어 추가했다. 첫 박보다 앞선 노트는 없다. 제목·아티스트는 곡 추천 메타데이터(224번 요청 CSV)와 글자 그대로 같고, AI 표기에서 국카스텐·혁오·검정치마는 아티스트를 한글로, 「거울」·「고민중독」은 제목을 한글로 바꿨고 DAY6 두 곡은 대소문자만 고쳤다. 배포 뒤 첫 시작 로그는 `공용 곡 카탈로그 결과 34곡:`에 REGISTERED 31·SKIPPED 3이다(시드 3곡이 이미 3난이도인 환경. 맵이라 키 순서는 바뀔 수 있다).
- **곡 추천 메타데이터 `meta`(255번, V38 `song_metadata`):** 필드·값 목록은 AI 요청 문서 COACH-004(224번 CSV)와 글자 그대로 같고, CSV의 `;` 다중 값만 JSON 배열이다. `genre`(필수, `ROCK POP KPOP BALLAD JAZZ FUNK LATIN METAL PUNK HIPHOP ELECTRONIC SOUNDTRACK PRACTICE OTHER` 중 1개)·`subGenres`(장르 0~2개)·`mood`(`CALM UPLIFTING ENERGETIC DARK SENTIMENTAL` 0~2개)·`energy`(1~5)·`releaseYear`(1900~2099)·`language`(`KO EN JA INSTRUMENTAL OTHER`)·`drumStyle`(`EIGHT_BEAT SIXTEEN_BEAT SHUFFLE HALF_TIME FOUR_ON_FLOOR DOUBLE_KICK SYNCOPATED FILL_HEAVY LATIN_PERCUSSION` 0~3개)·`source`(필수, `HUMAN AUTO EXTERNAL_DB`)·`sourceNote`(`EXTERNAL_DB`면 필수, 200자 이하). 모르는 값은 필드를 빼고, 같은 값을 두 번 쓰지 않는다. **라이선스·아티스트와 달리 앱이 시작할 때마다(배포·재시작) 결과(REGISTERED·FILLED·SKIPPED)와 무관하게 카탈로그 값으로 덮어쓰고, `meta`를 빼면 DB 행을 지운다.** 메타데이터 저장이 실패하면 곡은 남고 그 곡 결과만 FAILED다. 34곡 값은 11/05 CSV v2를 그대로 옮겼다(모두 `HUMAN`, `drumStyle`은 확실한 곡만). 255번 배포 뒤 첫 시작은 곡이 이미 있으면 34곡 모두 SKIPPED이고 `song_metadata`에 34행이 생긴다. 읽는 곳: AI 배치 뷰 `recommend_song_meta_v`(아래 R3), 비슷한 곡 R2, ADMIN 상세 `metadata`.
- **반주:** 카탈로그는 반주를 다루지 않는다. 배포 뒤 ADMIN이 `GET /api/v1/admin/songs`로 제목에 맞는 곡 id를 찾아 156번 `PUT /api/v1/admin/songs/{id}/accompaniment`(WAV·MP3, 50 MiB·10분 이하)로 올린다. 31곡의 드럼리스 음원은 저장소에 커밋하지 않고 운영 저장소에만 둔다(MP3 192 kbps로 변환해 올림).
- **곡 추가:** MIDI를 `midi/`에 넣고 카탈로그에 한 줄 추가(추천에 쓰려면 `meta`도) → MR에서 라이선스 리뷰 → 배포. 반주는 위 ADMIN 업로드로 붙인다.

```powershell
.\gradlew.bat test --tests '*BuiltinSong*' --tests '*SongMetadata*'
```

## 학습 코스(입문·중급) (331번, 중급 11/13)

SETUP. 드럼을 처음 치는 사람이 스테이지를 순서대로 통과하며 배우는 코스다. 입문 코스(킥·스네어·하이햇, 레슨 12개) 뒤에 중급 코스(크래시·라이드·탐 세 개·하이햇 페달, 레슨 10개)가 이어진다. 레슨은 공용 곡 카탈로그의 곡이고, 화면은 FE 악보 연습의 [학습 코스]다.

- **카탈로그 `lesson`:** `course`(`BEGINNER`·`INTERMEDIATE`, 기본 `BEGINNER`)·`order`(1 이상, 같은 코스 안에서 겹치지 않고 1부터 이어짐)·`kind`(`READ` 알아보기·`PLAY` 연주, 기본 `PLAY`)·`summary`(1~200자)·`pads`(패드 이름 1~9개, 중복 없음)·`guide`(`READ`에만, 기본 true: 음표 이름과 드럼을 처음부터 알려 줌). 레슨 곡은 `meta`를 두지 않는다. 레슨 곡 제목은 「입문 · 」·「중급 · 」로 시작한다. 앱이 시작할 때마다 곡을 모두 처리한 뒤 `lessons`(V48·V50)를 카탈로그 레슨으로 통째로 바꾼다(빼면 레슨에서 빠지고 곡은 남는다). 교체가 실패해도 곡 등록 결과는 그대로이고 레슨은 이전 상태로 남는다.
- **레슨 MIDI:** `scripts/lesson_midi.py`로 만든다(4/4, 70 BPM, 세기 100, 8분 격자 위, 같은 시각 2개 이하 — 스크립트가 검사한다). 중급 파일은 `lesson-int-*.mid`이고 GM 번호는 `GmDrumMapping` 표를 따른다(크래시 49·라이드 51·스몰탐 48·미드탐 45·플로어탐 43·하이햇 페달 44). 다시 만들어도 기존 입문 파일은 바이트가 같다. 연주 레슨은 4마디이고 「입문 · 킥으로 박자 세기」만 2마디(킥 8번, 곡 길이 9,429ms)다(385번, 시연용). 이 곡이 이미 등록된 환경은 시더가 건너뛰므로 배포 뒤 ADMIN `PUT /api/v1/admin/songs/{id}/charts/midi`에 `lesson-kick-quarter.mid`를 올려 새 버전을 만든다(`offsetMs` 생략, 기존 버전·플레이 기록은 남는다). 레슨 채보는 NORMAL이고 NORMAL 솎기 결과가 원본과 같으며 채보의 패드가 `lesson.pads`와 같다(`BuiltinSongSeederTest.저장소_카탈로그의_레슨은_…`이 검사). 260번 규칙으로 HARD·EASY는 목록에서 숨는다.
- **목록에서 빠짐:** `lessons`에 있는 곡은 공용 곡 목록(`GET /api/v1/songs?source=BUILTIN`)·추천 R1(곡 선택·리포트·연습)·비슷한 곡 R2 후보에 나오지 않는다(`LessonRepository.NOT_LESSON`). 곡 상세·채보 조회·연주 저장·최고 기록·ADMIN 목록은 그대로 된다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/v1/lessons` | 레슨 목록과 본인 진도. `passAccuracy`(70)와 `items`(입문 전부 → 중급, 코스 안 순서대로): `order`(코스 안 순서)·`course`·`kind`·`songId`·`chartId`(NORMAL)·`title`·`summary`·`pads`·`guide`·`bpm`·`durationMs`·`noteCount`·`bestAccuracy`·`passed`·`locked` |
| POST | `/api/v1/lessons/{songId}/completion` | 알아보기 레슨 완료 저장. 본문 없음, 204. 다시 보내도 204이고 처음 시각을 유지 |

- **통과:** 연주 레슨은 1배속 악보 연습(SHEET)으로 끝까지 친(`endReason=COMPLETED`) 기록 중 그 레슨 NORMAL 채보의 최고 정확도가 70 이상(69.99는 아님, 11/10 80에서 낮춤). 11/12부터 GOOD이 80점(`SCORE_V2`)이라 하나도 놓치지 않고 전부 GOOD이면 80%로 통과한다. 지난 V1 기록은 다시 계산하지 않는다. 리듬 게임 기록은 세지 않는다. 알아보기 레슨은 `lesson_completions`에 행이 있으면 통과. `locked`는 목록에서 앞 레슨(앞 코스 포함) 중 통과하지 못한 것이 있으면 참이다. 그래서 입문을 다 통과해야 중급 1번이 열린다. 잠금은 화면 안내라 서버는 순서를 강제하지 않는다(잠긴 레슨도 연주 저장은 된다).
- **오류:** 로그인 안 함·탈퇴 401, 완료 저장에서 연주 레슨 400 `VALIDATION_FAILED`, 레슨이 아니거나 삭제·비공개 곡 404 `SONG_NOT_FOUND`. 두 API 모두 `Cache-Control: private, no-store`.
- **탈퇴:** 탈퇴 커밋 뒤 그 회원의 `lesson_completions`를 지운다(`LessonWithdrawalListener`). 연주 기록은 기존 탈퇴 규칙을 따른다.
- **알려진 점:** AI 배치 뷰 `recommend_songs_v`(V37)는 레슨 곡을 거르지 않는다. 학습 데이터에서 빼야 하면 뷰를 바꾸는 후속 작업이 필요하다.

```powershell
.\gradlew.bat test --tests '*Lesson*' --tests '*BuiltinSong*'
```

## 내 악보 보관 (155번)

CHART-001. 회원이 악보 이미지나 PDF를 서버에 보관하고 다시 본다. 채보와는 무관하며, 개인 곡에는 선택적으로 하나를 연결할 수 있다([개인 곡 연결 (248번)](#개인-곡-연결-248번)). FE가 채보로 렌더링한 악보(`source=RENDERED`)와 사용자가 가진 악보(`UPLOADED`, 기본)를 같은 보관함에 둔다.
모든 경로는 `/api/v1/sheets`이고 Bearer 인증이 필요하다. 미인증·탈퇴 401, 남의 악보·없는 악보·삭제된 악보는 404 `SHEET_NOT_FOUND`. 응답은 `Cache-Control: private, no-store`.

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `POST /` | multipart `files`(같은 이름으로 여러 개, 순서가 페이지 순서), `title` 1~100자, 선택 `source` `UPLOADED`·`RENDERED`, 선택 `songId`(연결할 개인 곡, 248번) | 201, `Location: /api/v1/sheets/{id}`, 악보 상세 |
| `GET /` | `q`(제목 부분 검색), `page` 0~100000, `size` 1~100 | `PageResponse<SheetSummary>`, 최신순 |
| `GET /{id}` | — | 악보 상세 |
| `PATCH /{id}` | JSON `{"title": "...", "songId": 42 \| null}` 중 1~2개 필드(333번). `title`은 제목, `songId`는 숫자면 개인 곡 연결(이미 연결돼 있으면 옮김)·`null`이면 해제. 없는 필드는 그대로 | 악보 상세 |
| `DELETE /{id}` | — | 204, 소프트 삭제 |

- **상세:** `id`, `title`, `source`, `kind`(`IMAGE`·`PDF`), `pageCount`, `totalBytes`, `thumbnailUrl`(이미지 악보의 1쪽, PDF는 null), `createdAt`, `updatedAt`, `pages[]`(`pageNo`, `url`, `contentType`, `width`, `height`, `bytes`), `expiresAt`, `songId`(연결된 개인 곡, 없으면 null). 목록 항목은 `pages`·`expiresAt`이 없다. URL은 1시간 서명 GET이며 `inline`이라 브라우저에서 바로 열린다. 만료되면 상세를 다시 부른다.
- **파일 규칙:** 한 악보는 JPG·PNG·WEBP 이미지 1~20장 또는 PDF 1개. 이미지는 장당 10 MiB, 가로·세로 8000px·4000만 화소 이하, PDF는 20 MiB 이하. 요청 전체는 전역 multipart 상한 50 MiB. 회원당 악보 100개·합계 500 MiB. 실제 바이트를 검사한다(이미지 디코드와 끝 표시, PDF `%PDF-` 머리와 끝 1 KiB 안 `%%EOF`). 확장자·Content-Type은 보지 않는다.
- **메모리:** 본문은 multipart 임시 파일에서 다시 임시 파일로 옮겨 저장소에도 파일에서 바로 올린다. 이미지는 400만 화소 이하로 줄여 읽는다(운영 힙 약 460MB 보호). 검사·저장 단계는 서버 전체 동시 2건이며 넘으면 503이다.
- **저장:** 악보 버킷(`CHART_ASSET_SHEET_BUCKET`)의 `sheet-music/{userId}/{sheetId}/{uuid}.{jpg|png|webp|pdf}`. 커버와 같은 악보 버킷 쓰기 자격증명으로 조건부 PUT(`If-None-Match: *`)하고, 서명은 `chart.assets` 읽기 자격증명을 쓴다. `CHART_ASSET_ENABLED=false`면 등록·조회 서명이 503이다.
- **정리:** 업로드 전에 임시 정리 작업(`SHEET_MUSIC`, 5분 뒤)을 등록하고 저장 뒤 페이지를 연결한다. 실패하면 악보 행을 소프트 삭제하고 503, 올라간 파일은 정리 작업자가 지운다. 삭제·탈퇴(`UserWithdrawnEvent` 커밋 뒤) 때 페이지 키를 바로 실행되도록 등록한다. 정리 작업자는 삭제되지 않은 악보·활성 회원의 페이지 키는 지우지 않는다.
- **Nginx:** `/api/v1/sheets` 요청 전체는 51 MiB까지 허용하며 개별 이미지 10 MiB·PDF 20 MiB 검증은 BE가 수행한다.

| 상태 | `code` | 경우 |
| --- | --- | --- |
| 400 | `SHEET_INVALID` | 제목·`source` 형식, 등록 `songId`가 양의 정수 문자열이 아님, PATCH `songId`가 양의 정수(Long 범위)도 `null`도 아님, 모르는 필드, 빈 PATCH 본문, 파일 없음·빈 파일·`files` 외 파트, 21장 이상, 이미지와 PDF 섞음, PDF 2개 이상, 깨진 파일, 화소 상한 |
| 404 | `SONG_NOT_FOUND` | 등록·PATCH의 `songId`의 곡이 본인의 살아 있는 개인 곡이 아님(남의 곡·없는 곡·지운 곡·공용 곡 모두) |
| 409 | `SHEET_ALREADY_LINKED` | 그 곡에 살아 있는 다른 악보가 이미 있음(업로드 중인 악보 포함). 지우거나 연결을 풀면 다시 연결할 수 있다 |
| 413 | `SHEET_TOO_LARGE` | 이미지 10 MiB·PDF 20 MiB 초과 |
| 413 | `SHEET_QUOTA_EXCEEDED` | 회원당 100개 또는 500 MiB 초과 |
| 415 | `SHEET_UNSUPPORTED` | JPG·PNG·WEBP·PDF가 아님(GIF·BMP·HEIC 등) |
| 503 | `SHEET_UNAVAILABLE` | 저장소 비활성·쓰기 실패, 동시 처리 초과 |

### 개인 곡 연결 (248번)

FE 요청(2026-11-06, `CHART-001_내-악보와-개인-곡-연결`)으로 10/30 결정("곡과 연결하지 않는다")을 바꿨다. 라이브러리의 곡 ⋯ 메뉴 [악보 보기 | 악보 올리기]가 곡에 맞는 악보를 찾기 위한 연결이며, 변환은 없다.

- 등록 때 선택 파트 `songId`(양의 정수 문자열)를 보내면 그 곡에 연결한다. 곡은 **본인 소유·삭제되지 않음·공용(`BUILTIN`)이 아님**이어야 하고 상태(처리 중·실패)는 보지 않는다. 아니면 모두 404 `SONG_NOT_FOUND`. `songId`가 없으면 지금처럼 곡 없는 악보다. `RENDERED`도 같은 규칙이다.
- **곡당 살아 있는 악보는 하나다.** `sheet_music_song_live_idx`(V44)가 보장하므로 동시에 올려도 하나만 들어가고 나머지는 409 `SHEET_ALREADY_LINKED`다. 악보를 소프트 삭제하면 자리가 비어 다시 올릴 수 있다. 업로드 실패로 소프트 삭제된 행도 자리를 차지하지 않는다.
- 악보 상세·목록 항목에 `songId`, 곡 목록·상세([187번](#개인-곡-관리커버-187번))에 `sheetId`가 나온다. 곡의 `sheetId`는 페이지가 연결된 살아 있는 악보만 가리키며(업로드 중인 행은 null), 공용 곡은 항상 null이다.
- **나중에 연결·해제(333번, 2026-11-09 FE 회신 2 "안 B"):** `PATCH /{id}`에 `songId`를 보내면 이미 올린 악보를 곡에 연결한다. 판정은 등록과 같다(404 `SONG_NOT_FOUND`, 409 `SHEET_ALREADY_LINKED`, 곡 상태 무관). `null`이면 해제한다. 이미 다른 곡에 연결된 악보에 다른 `songId`를 보내면 **옮기고**(이전 곡의 `sheetId`는 null) 지금 연결된 곡과 같은 값이면 아무것도 바꾸지 않는다. FE는 악보만 있는 카드의 [곡 올리기]로 곡을 만든 직후(201·202) 이 PATCH를 부른다.
- **곡을 지우면**(`DELETE /api/v1/songs/{id}`) 연결된 악보는 **지우지 않고 `song_id`만 비운다**(`domain.sheet.service.SheetSongLink.unlinkAll`, 같은 트랜잭션, 업로드 중 행 포함). 페이지 파일은 정리 큐에 올리지 않으며 악보는 곡 없는 악보로 다시 보인다. 11/06(248번)에는 악보도 같이 소프트 삭제했으나 FE에 곡 없는 악보 화면이 생겨 333번에서 바꿨다. V44 마이그레이션 파일의 주석은 그때 기준이며 Flyway 체크섬 때문에 고치지 않는다. 악보만 지우면 곡은 그대로다. 회원 탈퇴 때 악보를 통째로 정리하는 처리는 그대로다.
- 곡 없는 악보가 늘어도 회원당 100개·500 MiB 한도는 그대로 적용된다. 정리는 악보 DELETE로 한다.
- 패키지 경계: `sheet`는 `songs` 테이블을 SQL로만 확인하고 `song`을 import하지 않는다. `song`은 `sheetId`를 `SongRepository` 서브쿼리로 읽고, 곡 삭제 때 `SheetSongLink`를 부른다(한 방향).

```powershell
.\gradlew.bat test --tests '*Sheet*'
```

## 연주 녹음 (256·257번)

REC-001. 자유·리듬·박자·악보 모드에서 녹음한 타격 시퀀스(시각·패드·세기)를 플레이 기록과 따로 저장한다. 자유 모드는 플레이 기록이 없어도 저장된다.
모든 경로는 `/api/v1/recordings` 아래이고 Bearer 인증이 필요하다. 미인증·탈퇴 401, 가입 동의 전 403 `SIGNUP_INCOMPLETE`. 응답은 `Cache-Control: private, no-store`.

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `POST /` | 아래 저장 본문(JSON) | 201 `Location: /api/v1/recordings/{id}`, 같은 키·같은 내용 재전송 200. 녹음 요약 |
| `GET /` | `q`(제목 부분 검색, 앞뒤 공백 제거 뒤 100자까지, `%`·`_`는 글자 그대로), `mode`(선택, `FREE`·`RHYTHM`·`SHEET`·`TEMPO` 중 하나), `sort`(`NEWEST` 기본·`OLDEST`), `page` 0~100000, `size` 1~100 | `PageResponse<RecordingSummary>`, 본인의 살아 있는 녹음만, `startedAt` 기준 정렬(같으면 id). 시퀀스·`timing` 없음 |
| `GET /{id}` | — | 녹음 상세: 요약 + `timing` + `hits[]` |
| `PATCH /{id}` | JSON `{"title": "..."}`만(4 KiB 이하, 모르는 필드·중복 키·후행 JSON 400). 제목 규칙은 저장과 같다 | 녹음 요약(`updatedAt` 갱신) |
| `DELETE /{id}` | — | 204, 소프트 삭제 |

남의 녹음·지운 녹음·없는 녹음은 상세·수정·삭제 모두 404 `RECORDING_NOT_FOUND`이고 목록에도 없다.

### 저장 본문 (256번)


| 필드 | 계약 |
| --- | --- |
| `schemaVersion` | 필수 `1` |
| `clientKey` | 필수 UUID. 녹음 시작 때 만들고 재전송 때 유지 |
| `title` | 필수 문자열, 앞뒤 공백 제거 후 1~100자(이모지도 한 글자) |
| `mode` / `inputSource` | 플레이 로그와 같은 `RHYTHM`·`FREE`·`TEMPO`·`SHEET` / `KEYBOARD`·`STICK` |
| `playId` | 선택. 본인 플레이이고 다른 녹음과 연결된 적 없어야 한다 |
| `startedAt` | 필수 ISO-8601 문자열(숫자 epoch 거부), 소수초 6자리까지, 2020-01-01 이상 2100-01-01 미만 |
| `durationMs` | 필수 0~7,200,000, 마지막 타격 `tMs` 이상 |
| `hits[]` | 필수 1~50,000개. `tMs`(0 이상 유한 실수), `pad`(플레이 로그 9종, `HI_TOM`은 `SMALL_TOM`으로 저장), `velocity`(0~127), 선택 `stickId`(0 왼손·1 오른손, `KEYBOARD`면 보낼 수 없음) |

- **정렬:** 타격 순서는 자유다. 서버가 `tMs`로 안정 정렬(같은 시각은 받은 순서 유지)해 저장하므로 저장된 시퀀스는 항상 시간순이다. `-0.0`은 `0`으로 저장한다.
- **중복 저장:** 같은 회원의 살아 있는 녹음에 같은 `clientKey`가 있으면 저장하지 않는다. 정규화한 내용(정렬·별칭·제목 다듬기 뒤, 키 순서·공백·숫자 표기·시간대와 무관)의 SHA-256이 같으면 200과 기존 녹음, 다르면 409. 지운 녹음의 키로 다시 보내면 새 녹음이다.
- **엄격 파싱:** 플레이 로그와 같은 규칙. 모르는 필드(판정·노트 ID 포함)·중복 키·후행 JSON·숫자 enum·문자열/소수 숫자 강제 변환·HTTP 본문 압축을 거부한다.
- **저장:** `recordings.hits` jsonb 한 컬럼(행 테이블 없음). 회원 행을 잠가 같은 회원의 저장을 한 줄로 세운다. 플레이가 지워지면 연결만 끊기고 시퀀스는 남는다.
- **응답:** `id`, `clientKey`, `title`, `mode`, `inputSource`, `playId`, `song`, `hitCount`, `durationMs`, `startedAt`, `createdAt`, `updatedAt`. 시퀀스는 돌려주지 않는다.
- **채보 버전 기록(V28):** `playId`가 있으면 그 플레이의 `chart_version_id`를 녹음에 함께 저장한다. 목록 `song`과 상세 `timing`은 이 값에서 나오므로 플레이가 지워져도 남는다.

### 보관함 (257번)

- **상세 `hits`:** 저장된 jsonb를 그대로 돌려준다(`tMs` 오름차순, `stickId` 없는 타격은 키 생략). 타격 50,000개면 약 3.5 MB다(검증 실측 3.55 MB). 응답 gzip은 앞단 Nginx가 맡는다.
- **`song`(요약·상세):** 리듬·악보 녹음이면 `{songId, title, difficulty}`, 자유·박자 녹음과 `playId` 없이 저장한 녹음은 null. 녹음이 기억한 채보 버전(V28) → `charts` → `songs` 조인이다. 녹음 `mode`가 아니라 연결한 플레이의 채보 버전을 따르며, 녹음 모드와 플레이 모드가 달라도 저장을 막지 않는다(FE는 같은 모드로 보낸다). `title`은 곡의 현재 제목이라 이름을 바꾸면 새 이름이고, 곡을 지워도(소프트 삭제) 보인다. `difficulty`는 `EASY`·`NORMAL`·`HARD`.
- **목록 `sort`·`mode`:** `sort`는 `startedAt` 기준 `NEWEST`(기본)·`OLDEST`, `mode`는 한 모드만 거른다. 다른 값(소문자·빈 값 포함)은 400 `RECORDING_INVALID`.
- **상세 `timing`:** MIDI 내보내기용 템포. 녹음이 기억한 채보 버전(V28 `recordings.chart_version_id`, 저장 때 플레이에서 복사)의 `timing`을 채보 API와 같은 이름으로 준다: `songId`, `chartVersionId`, `bpm`, `offsetMs`(곡 0ms 기준 첫 박), `timeSignature`, `ppq`, `tempoMap`, `timeSignatureMap`. 곡의 현재 BPM이 아니라 녹음 당시 버전 값이라 곡 BPM이 나중에 바뀌어도 같다(`domain.chart.model.ChartDocumentReader.timing` 재사용). 채보 버전이 없으면(자유·박자) null. 플레이가 지워져도 남는다. 목록에는 없다.
- **제목 변경:** 저장 때 계산한 `payload_hash`는 다시 계산하지 않는다. 그래서 제목을 바꾼 뒤 원래 저장 요청을 재전송해도 200(바뀐 제목의 요약)이고, 다른 내용으로 보내면 409다.
- **삭제:** `deleted_at`을 찍는 소프트 삭제이며 **`play_session_id`도 비운다.** `play_session_id`는 지운 녹음까지 전체에서 유일해서, 비우지 않으면 지운 녹음이 플레이를 붙들어 같은 플레이의 새 녹음이 404가 된다. 지운 뒤 같은 `clientKey`·같은 `playId`로 저장하면 새 녹음이다. 회원당 200개 상한은 살아 있는 녹음만 센다.
- **탈퇴:** `domain.withdrawal.service.WithdrawalService` 트랜잭션 안에서 그 회원의 녹음 행을 모두(지운 것 포함) 지운다. 파일이 없어 정리 큐는 쓰지 않는다. 가입 미완료 계정 정리는 `users` 행 삭제의 FK CASCADE로 함께 지워진다.
- 수정·삭제의 잠금 대기 초과도 저장과 같이 503 `RECORDING_BUSY`다. 상세·목록은 잠그지 않는다.
- **저장값 읽기:** jsonb는 `1e-70` 같은 아주 작은 수를 긴 소수로 풀어 저장하므로, 상세는 숫자 길이 제한을 넉넉히 둔 별도 매퍼로 읽는다.
- **제목:** 짝이 맞지 않는 서로게이트(이모지 반쪽)는 DB에 `?`로 바뀌어 저장되므로 저장·변경 모두 400이다.

| 상태 | `code` | 경우 |
| --- | --- | --- |
| 201 | — | 최초 저장, `Location: /api/v1/recordings/{id}` |
| 200 | — | 같은 키·같은 내용 재전송 |
| 400 | `RECORDING_INVALID` | 필수·범위·형식, 마지막 타격이 길이보다 늦음, 모르는 필드, 압축 본문 |
| 404 | `RECORDING_PLAY_NOT_FOUND` | `playId`가 없거나 남의 것, 이미 다른 녹음과 연결됨 |
| 404 | `RECORDING_NOT_FOUND` | 상세·수정·삭제에서 없는·지운·남의 녹음 |
| 409 | `RECORDING_CONFLICT` | 같은 키, 다른 내용 |
| 409 | `RECORDING_SCHEMA_UNSUPPORTED` | `schemaVersion`이 1이 아님 |
| 413 | `RECORDING_TOO_LARGE` | 본문 5 MiB, 타격 50,000개, 2시간 초과 |
| 413 | `RECORDING_QUOTA_EXCEEDED` | 살아 있는 녹음 회원당 200개 |
| 503 | `RECORDING_BUSY` | 잠금 대기 3초·문장 10초 초과(PostgreSQL 55P03·57014). 같은 요청을 다시 보낸다 |

```powershell
.\gradlew.bat test --tests '*Recording*' --tests '*Withdrawal*' --tests '*PendingSignupCleanupTest'
```

## 채보 작업 진행 조회·알림 (172번)

`GET /api/v1/jobs/{jobId}`는 Bearer access 토큰으로 본인의 최신 작업 상태를 반환한다. 타인·삭제된 곡·없는 작업은 404, 미인증·비활성 회원은 401이다. `GET /api/v1/jobs?status=QUEUED&page=0&size=20`은 본인 작업 목록을 `PageResponse`로 반환한다. `status`는 선택이며 `QUEUED`, `SEPARATING`, `TRANSCRIBING`, `DONE`, `FAILED` 중 하나다. page는 0~100000, size는 1~100이다. 다른 브라우저에서 jobId를 모르면 목록으로 복구할 수 있다.

두 GET과 WS는 동일한 DB 상태를 사용한다. JobSnapshot은 숫자 `jobId`, `songId`, `progress`(0~100), `revision`, 문자열 `status`, `error`(null 또는 안전한 `code`·`message`·null 가능한 `reason`), UTC 시각 `createdAt`, `startedAt`, `finishedAt`으로 구성된다. 오류 원문·파일 키는 노출하지 않는다. 재시도에서는 progress가 감소할 수 있으므로 FE는 revision이 증가한 상태만 적용한다.

브라우저는 `wss://<호스트>/ws/jobs/{jobId}`를 연결하고 **5초 안에 첫 텍스트 프레임**으로 `{"type":"AUTH","accessToken":"<access token>"}`을 보낸다. 인증 전 데이터는 전송하지 않는다. URL 쿼리와 추가 필드·중복 키·후행 JSON은 허용하지 않으며 텍스트·바이너리 프레임 한도는 4096바이트다. 서버는 토큰·ACTIVE·본인 소유·곡 삭제를 확인하고 현재 JobSnapshot을 먼저 보낸 뒤 revision이 커진 커밋 상태만 보낸다. DONE·FAILED는 최종 스냅샷을 보낸 후 1000으로 닫는다. 이미 끝난 작업에 접속하면 현재 스냅샷 한 개를 받은 뒤 닫힌다. 인증 실패·만료·접근 불가·잘못된 인증 프레임은 1008, 프레임 한도 초과는 1009, 연결 한도 초과는 1013, 서버 오류는 1011이다. 소켓이 닫히거나 느리면 FE는 GET으로 현재 상태를 복구하고 필요할 때 재연결한다. 연결 불가 중에는 3초 간격의 GET 복구를 사용할 수 있으며 DONE·FAILED 또는 401·404에서 중단한다.

연결은 인스턴스 전체 200개, 인증 회원당 4개로 제한한다. 활성 구독만 약 1초마다 DB 상태를 확인하고, 매 전송 전 토큰 만료·회원 상태·작업 접근을 다시 검사한다. 무변경 연결도 확인하며 30초마다 WebSocket ping을 전송한다. 이 간격과 연결 한도는 초기 설정이며 성능 측정 결과가 아니다. Nginx는 `/ws/jobs/`만 BE로 전달하고 read timeout을 120초로 둔다. WS 접근 로그는 URL 토큰 노출 방지를 위해 끈다.

`CHART_JOBS_WEBSOCKET_ALLOWED_ORIGINS`는 쉼표로 구분한 정확한 Origin 목록이다. 개발 기본값은 `http://localhost:5173,http://127.0.0.1:5173`이며 누락 Origin과 와일드카드는 허용하지 않는다. 운영 Compose에서 실제 FE HTTPS Origin을 명시해야 한다. Nginx 설정·Origin 값은 배포 환경에 반영하고 직접 연결을 확인해야 하며 이번 로컬 검증이 실제 배포 성공을 뜻하지 않는다.

## AI 워커 내부 작업 API (160번)

`/internal/v1/chart-jobs/`는 HTTPS Nginx에서 지정한 AI 워커 IP `222.107.238.74`만 접근할 수 있다. 그 밖의 `/internal/`은 404이며 HTTP의 `/internal/`도 404다. Nginx 요청 본문 한도는 8 MiB이고 BE 결과 JSON 한도는 5 MiB다. 사용자 access JWT는 사용할 수 없다. `CHART_WORKER_CREDENTIALS`에 `worker1=토큰,worker2=토큰` 형태로 등록하며 각 토큰은 UTF-8 32바이트 이상이고 서로 달라야 한다. 빈 설정은 모든 요청을 401로 거부한다. 값에는 쉼표를 쓰지 않고 충분한 난수로 생성해 비밀 관리 경로로 주입한다. 워커는 자기 토큰을 Bearer로 전송한다. 전송 경로를 TLS 또는 이에 준하는 보호된 내부 연결로 구성한다. 토큰·서명 URL을 로그에 남기지 않는다. Nginx는 해당 워커 API와 서명 URL 경로의 접근·오류 로그를 끄며 BE·저장소 메트릭으로 진단한다.

`AUDIO_STORAGE_PUBLIC_ENDPOINT`는 AI 워커가 접근할 수 있는 S3 주소다. 일반 설정의 기본은 BE 내부 음원 endpoint이며 Infra Compose에서는 `OBJECT_STORAGE_PUBLIC_URL`을 기본으로 사용한다. 외부 GPU에서는 `https://k15a307.p.ssafy.io`처럼 워커가 접근 가능한 공개 주소를 사용한다. BE의 내부 저장소 endpoint는 그대로 유지한다. 워커용 임시 음원 버킷과 반주 버킷은 비공개·비버전이어야 한다. 최종 반주 쓰기 자격증명은 기본적으로 `AUDIO_STORAGE_ACCESS_KEY/SECRET_KEY`이며 필요하면 `WORKER_STORAGE_ACCOMPANIMENT_WRITE_ACCESS_KEY/SECRET_KEY`로 별도 지정한다. 최종 반주와 드럼 체크포인트 생성에 S3 조건부 PUT(`If-None-Match: *`) 지원이 필요하다. SeaweedFS의 서명된 청크 처리 호환을 위해 음원·워커 쓰기 클라이언트는 청크 인코딩을 끄되 SDK의 기본 CRC32 요청 체크섬은 유지한다. `WORKER_STORAGE_URL_TTL`은 1~10분이며 기본 10분이다. 음원 다운로드와 FLAC 검증에 `ffprobe`가 필요하다.

반주 쓰기 자격증명에는 반주 버킷의 `s3:GetBucketVersioning`과 반주 객체의 `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` 권한이 필요하다. 반주 승격·공용 반주 업로드·정리 조회·삭제 전에 매번 버전 상태를 확인하며, 버전 상태가 미기재이거나 비어 있는 버킷만 허용한다(공백도 빈 상태로 취급한다). `Enabled`, `Suspended` 및 알 수 없는 비공백 상태는 거절한다. 조회 권한 부족·저장소 장애도 작업 실패로 처리하고 정리는 기존 방식대로 재시도한다. 상태 확인과 객체 작업은 원자적이지 않으므로 운영자가 버킷의 버전 설정을 변경하지 않도록 관리해야 한다. 서비스는 버전 상태를 바꾸거나 기존 버전 객체를 삭제하지 않으며 상태 변경 권한이 필요 없다. 자격증명·서명 URL·저장소 오류 원문을 로그에 남기지 않는다.

| 요청 | 주요 입력과 동작 |
| --- | --- |
| `POST /claim` | `workerId`, UUID `claimRequestId`. 배정은 200, 대기 작업 없음은 204. `input.durationMs`는 BE가 원곡 접수 때 저장한 길이이며 SOURCE_AUDIO와 DRUM_STEM 모두 같은 값이다. 같은 요청 ID의 유효 배정은 복구되며 만료된 ID는 409다. |
| `POST /{jobId}/heartbeat` | `attemptId`, 증가하는 `eventSeq`, `progress`. 분리 0~49, 채보 50~99. 중복·이전 순번은 임대를 연장하지 않는다. |
| `POST /{jobId}/file-access` | `attemptId`, `files` 배열. 분리 입력은 `{role: SOURCE_AUDIO, fileId: 배정 input.fileId}`, 분리 출력은 `DRUM_STEM`·`ACCOMPANIMENT`이며 각 파일의 `sizeBytes`를 지정한다. fileId 생략 시 각 시도에 하나씩 발급한다. 채보 입력은 `{role: DRUM_STEM, fileId: 배정 input.fileId}`. 응답은 역할·fileId·GET/PUT·URL·만료시각이다. PUT 시 `Content-Type: audio/flac`과 지정한 `Content-Length`를 사용한다. |
| `POST /{jobId}/results/separation` | 공통 결과 봉투와 `drumStem`, `accompaniment` manifest, `durationMs`, `audioTimeOrigin`, `model`, `metrics`를 제출한다. 분리 파일은 FLAC 16비트·44,100Hz·스테레오, 시간축은 `SOURCE_START`다. |
| `POST /{jobId}/results/transcription` | 같은 봉투 안에 schemaVersion 1·NORMAL 채보 하나를 제출한다. `generator`는 `ADT_MODEL`, `generatorVersion`은 1~50자, `metrics`는 객체다. 각 채보는 `difficulty`, `notes`, `timing`, `notationStatus`를 가지며 신규 `sheetPages`는 허용하지 않는다. |
| `POST /{jobId}/failure` | `attemptId`, `eventSeq`, `stage`, `code`, `retryable`, 200자 이내 단일 행 `summary`, 선택 `reason`. `reason`의 허용값은 `SOURCE_INVALID`, `NOT_TRANSCRIBABLE`, `GPU_OUT_OF_MEMORY`, `INTERNAL_ERROR`이며 생략·null을 허용하고 다른 값은 400으로 거절한다. `INPUT_INVALID`, `MODEL_FAILED`, `OUTPUT_INVALID` 중 `MODEL_FAILED`만 재시도 가능 보고를 허용하며 AI는 GPU OOM일 때만 true를 보낸다. 진단 원문은 저장하지 않는다. |

원곡 길이가 없거나 0 또는 600,000ms를 넘는 대기 작업은 `INPUT_INVALID`로 실패하고 입력 정리 대상이 된다. 동일 요청 재조회 중 길이가 유효하지 않으면 409를 반환한다. 새 작업 배정과 만료 작업 복구는 회원·곡·작업 행 중 잠긴 후보를 건너뛰고 다른 후보를 처리한다. 건너뛴 후보는 이후 배정 또는 복구 주기에 다시 확인한다.

claim의 `input` 예시(파일 ID·크기·해시는 설명용):

```json
{
  "role": "SOURCE_AUDIO",
  "fileId": "33333333-3333-4333-8333-333333333333",
  "contentType": "audio/wav",
  "sizeBytes": 176444,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "durationMs": 1000
}
```

`contractVersion`은 1을 유지하며 `durationMs`는 추가 필드다. 같은 claim 재조회에서 분리 인수 후 또는 새 시도의 재배정으로 `DRUM_STEM`을 받더라도 원곡 기준 길이는 같다. BE는 입력·분리 출력의 ffprobe `format.duration` 초 문자열을 십진수로 읽고 1000을 곱해 올림한 정수 ms를 비교한다. 기존에 저장된 원곡 길이는 재계산하지 않는다. MP3의 보고 길이는 ffprobe 버전이나 디코더에 따라 다를 수 있으므로 워커는 직접 측정한 길이 대신 배정받은 값을 기준으로 사용한다. 양수·600초 이하만 허용하고 분리 결과의 `durationMs`와 두 FLAC 길이는 이 값과 같아야 한다. 워커는 44,100Hz 출력의 기준 샘플 수를 `floor(durationMs * 44100 / 1000)` 정수 연산으로 정하고, 필요한 경우 끝에서만 자르거나 무음을 채울 수 있다. 시작점을 바꾸거나 추정 지연을 `timeMs`·offset에 더하지 않는다. 이는 길이 일치를 위한 권장 방식이며 BE가 특정 샘플 수 자체를 강제하지는 않는다.

manifest는 발급된 `fileId`, `contentType: audio/flac`, 양수 `sizeBytes`, 소문자 SHA-256 `sha256`을 포함한다. 분리 파일 한 개의 상한은 128MiB로, 사용자 입력 50MiB와 별개다. metrics에는 `loadMs`, `separateMs`, `peakVramMb`, `peakRamMb`를 사용하며 메모리 필드는 null을 허용하고 MB는 1,000,000바이트다. `model.name`은 `bs_roformer_sw`, version은 가중치 파일명·`@`·설정 해시 소문자 12자리다. 반주와 체크포인트는 검증된 바이트로 별도 불변 키에 저장한다. 파일 업로드나 외부 검사 중 DB 잠금을 유지하지 않는다.

결과 봉투는 `contractVersion: 1`, `jobId`, `attemptId`, UUID `resultId`, 소문자 `payloadHash`, `result`다. `payloadHash`는 **result 객체만** 다음 규칙으로 정규화한 UTF-8 바이트의 SHA-256이다. 객체 키는 Java 문자열의 UTF-16 코드 단위 사전순으로 정렬하고 배열 순서는 유지한다. 공백 없이 JSON을 쓰며 문자열은 Jackson의 일반 JSON 이스케이프(제어 문자·역슬래시·따옴표 이스케이프, 그 외 유니코드 그대로)를 쓴다. 숫자는 십진수 값의 후행 0을 없애고 지수 표기 없이 쓰며 모든 0은 `0`이다. null·true·false는 그대로 쓴다. 중복 키, JSON 후행 데이터, 24단계 초과 중첩 및 과도한 숫자는 거부한다. 예를 들어 입력 result `{"b":[true,null],"a":1.00}`의 정규 바이트는 `{"a":1,"b":[true,null]}`다. 원래 바이트 전체나 envelope의 해시가 아니다.

교차 언어 검증 입력 result는 `{"😀":-0.00,"\uE000":1.2300,"제어":"x\u001f\n","prec":0.12345678901234567890123456789012345}`이며 SHA-256은 `a6385d023ac91b8d496887d40c7f840cf7790eb20ddc16ae866e0a080c541921`이다. `\uE000`은 빈 키가 아니라 U+E000 문자 키다. 복사 과정에서 해당 문자가 누락되지 않도록 이스케이프 표기를 사용한다.

워커 결과의 필수 문자열과 객체 형태를 검사하며 유효 시도의 잘못된 타입에는 422 `WORKER_RESULT_INVALID`를 반환하고 작업을 `OUTPUT_INVALID`로 실패 처리해 기존 정리 경로에 등록한다. 잘못된 요청 봉투는 400, 오래된 시도는 409다.

인수된 같은 resultId·같은 정규 내용은 임대가 끝나도 기존 Receipt를 반환한다. 같은 ID의 다른 내용, 오래된 attempt, 삭제·탈퇴 자원은 409다. 유효 시도의 잘못된 결과는 FAILED·정리 기록을 커밋하고 422를 반환하며 스토리지 일시 장애는 503으로 같은 요청을 재전송할 수 있다. 60초 임대와 단계별 최대 2회 재시도는 초기 설정이며 5초/15초 재시도 대기와 단계 누적 상한을 적용한다. 전송 오류의 워커 측 재시도를 소진해 heartbeat를 중단하면 임대 만료 후 복구될 수 있지만 단계 마감과 단계별 최대 2회 재시도 범위 안에서만 재배정된다. 409·422 또는 이미 DONE인 경우 재배정을 보장하지 않는다. 원본은 분리 인수 뒤, 드럼은 최종 인수 또는 실패 뒤 정리하며 staging의 늦은 업로드를 재검사한다.

음원 전사 입력의 `NORMAL` 한 개는 계약 호환을 위해 유지하며, 저장할 때 원본 전체를 HARD로 보존하고 `midi-rule-2.0`으로 NORMAL·EASY를 각각 생성한다. 세 채보와 버전, Receipt는 한 트랜잭션에 저장한다. 기존 음원 채보는 소급 변환하지 않는다. 파생 노트는 원본 JSON과 배열 순서를 보존한다. 모든 노트에 notation과 유효한 ppq가 있으면 해당 tick을 사용하고, 그렇지 않으면 ppq 480으로 가상 tick을 계산한다(0 미만은 0). timing에 `tempoMap`이 둘 이상이고 `ppq`가 있으면 offsetMs부터 빠르기 구간마다 그 BPM으로 박 수를 세고(`TranscriptionCharts.VirtualTicks`, 구간 시작은 채보마다 한 번 계산하고 노트마다 이분 탐색), 없으면 BPM 하나로 환산한다. EASY 박을 정하는 템포도 tick을 만든 기준과 같다: notation tick이면 `tempoMap`(없으면 `bpm`), 가상 tick이면 그 구간 목록(없으면 `bpm`). timeMs는 변경하지 않는다. velocityHint가 없으면 솎기 판단에만 100을 사용한다. HARD의 generatorVersion은 입력 원문을 유지하고 파생 버전에는 `+midi-rule-2.0`을 붙인다. 50자를 넘을 경우 원문 앞부분과 SHA-256의 앞 12자리로 결정적으로 축약한다. 각 난이도는 HARD에서 독립적으로 솎으므로 노트 수의 순서는 모든 입력에 보장되지 않는다.

채보는 현재 BE가 읽을 수 있는 schemaVersion 1, 9개 패드 KICK·SNARE·HIHAT·HIHAT_PEDAL·SMALL_TOM·MID_TOM·FLOOR_TOM·CRASH·RIDE, 순서가 있는 정수 timeMs와 고유 noteId를 검사한다. READY는 모든 노트의 notation과 ppq·tempoMap·timeSignatureMap을 검사한다. AI 169번의 실제 notes/timing/notation 샘플과 FE 렌더링 정합성은 아직 검증되지 않았고 이 문서의 구조가 모델 샘플의 확정을 뜻하지 않는다. WS·실제 AI 워커·모델 및 실제 배포 스토리지 통합은 별도 검증이 필요하다.


### 워커가 꺼졌을 때 대기 작업 실패 처리 (383번)

BE는 채보 워커가 `POST /claim`이나 `POST /{jobId}/heartbeat`를 보낼 때마다 `chart_worker_presence`에 그 워커의 마지막 연락 시각을 기록한다. claim 결과가 204여도, 요청이 409로 거절돼도 기록한다. 워커는 대기 작업이 없을 때 5초마다 claim을, 작업 중에는 10초마다 heartbeat를 보낸다.

10초마다 도는 복구 주기에서 기록된 워커가 없거나 모든 워커의 마지막 연락이 `chart.worker.offline-after-ms`(환경변수 `CHART_WORKER_OFFLINE_AFTER_MS`, 기본 60000)보다 오래되면 대기 중인 채보 작업을 `WORKER_OFFLINE`으로 실패 처리한다. 곡은 FAILED가 되고 원곡은 기존 실패와 같이 정리 대상에 들어간다. 사용자는 실패 화면에서 곡을 다시 올리면 된다. 판정 순서는 탈퇴·곡 삭제(`JOB_CANCELLED`), 대기 30분·단계 마감 초과(`STAGE_TIMEOUT`), 워커 꺼짐(`WORKER_OFFLINE`) 순이다. 값을 0으로 두면 이 검사를 끄고 기존처럼 30분 뒤 `STAGE_TIMEOUT`으로만 끝난다.

- 워커가 꺼진 뒤 올린 곡은 약 10초 안에 실패로 끝난다.
- 처리 중에 워커가 꺼지면 60초 임대 만료로 작업이 대기로 돌아가고, 다음 복구 주기에서 `WORKER_OFFLINE`으로 끝난다. 워커가 꺼진 뒤 약 70초다.
- 워커를 다시 띄우면 모델을 올리는 동안에는 claim이 없어서 그 사이에 올린 곡은 실패한다. 첫 claim부터 새 곡은 정상 처리된다.
- 공개 오류는 `code: WORKER_OFFLINE`, `message: 채보 서버가 잠시 멈춰 있습니다. 잠시 뒤 다시 올려 주세요.`이고 `reason`은 null이다.
- 리포트 LLM 총평과 연주 중 코칭 작업 큐는 이 검사를 쓰지 않는다.

운영에서 워커 연락 상태는 다음 SQL로 확인한다.

```sql
SELECT worker_id, last_seen_at, clock_timestamp() - last_seen_at AS 지난_시간 FROM chart_worker_presence ORDER BY last_seen_at DESC;
```

테스트 컨텍스트는 같은 DB를 쓰고 일부는 10초마다 복구 주기가 돌아서, `TestPropertyDefaultsInitializer`가 이 검사를 기본으로 끈다. 검사 테스트는 `WorkerOfflineTest`이며 `chart.worker.offline-after-ms=60000`으로 켠다.

## 리포트 종합 총평과 LLM 총평 작업 (COACH-003 후속)

AI가 약점 분석 응답의 루트에 붙이는 `summary`(`level`·`text`·`focusPattern`·`strengthPad`·`source`)를 `reports.coach_summary`(V32)에 저장하고
리포트 응답에 `coachSummary`로 내려 준다. 계약과 가드레일은 `AI/docs/coach-narrative.md`.

- **저장:** `AnalysisClient`가 `summary`를 검증한다(`level`은 GOOD·FAIR·NEEDS_WORK, `text` 1~500자·제어 문자 없음, `focusPattern`·`strengthPad`는 `[A-Z0-9_]{1,40}`,
  `source`는 RULE·LLM). 알려진 필드만 저장하고, **틀리면 총평만 버리고 약점 분석은 그대로 성공**으로 둔다(총평은 부가 정보다). 약점 분석이 DONE일 때만 저장한다.
  이미 만들어진 리포트는 소급하지 않는다(`coachSummary`가 null).
- **응답:** `INSUFFICIENT_HITS`나 분석 실패면 `coachSummary`는 null이다. `source`가 `RULE`이면 규칙 문장, `LLM`이면 GPU 서버의 모델이 쓴 문장이다.
- **LLM 총평 작업:** 총평이 저장되면 리포트마다 작업 하나(`coach_narrative_jobs`, `report_id` 유일)가 대기열에 생긴다. 교내 GPU 서버의 워커가 가져가(pull) 로컬 오픈소스 모델이 쓴 문장을 제출하면
  `coach_summary.text`를 그 문장으로 덮어쓰고 `source`를 `LLM`으로 바꾼다(`level`·`focusPattern`은 그대로). 실패하거나 임대가 끝나면 규칙 총평이 그대로 남는다.

워커 API(채보 워커와 같은 Bearer 토큰 인증, `/internal/**`):

| 호출 | 요청 | 응답 |
| --- | --- | --- |
| `POST /internal/v1/coach-narratives/claim` | `{workerId, claimRequestId}` | 작업이 없으면 204. 있으면 `{jobId, attemptId, leaseExpiresAt, facts}`. 같은 워커·같은 `claimRequestId`는 같은 배정을 돌려준다 |
| `POST /internal/v1/coach-narratives/{jobId}/result` | `{attemptId, text, model, generationMs}` | `{status: DONE}`. `text` 1~500자·제어 문자 없음, `model` 37자 이하, `generationMs` 0~3,600,000 |
| `POST /internal/v1/coach-narratives/{jobId}/failure` | `{attemptId, code, retryable, summary}` | `{status: QUEUED 또는 FAILED}`. `code`는 INPUT_INVALID·MODEL_FAILED·OUTPUT_INVALID, `retryable`은 MODEL_FAILED만 가능, `summary` 200자 이하 한 줄 |

- 임대는 120초이고 heartbeat는 없다. 임대가 끝난 작업은 다음 `claim`에서 대기열로 돌아가고(시도 2번까지) 시도를 다 쓰면 FAILED로 닫힌다. 임대가 끝난 뒤의 제출이나 다른 워커·다른 시도의 제출은 409 `WORKER_CONFLICT`, 형식 오류는 400 `WORKER_INVALID`.
- `facts`에는 타격 원본·회원 번호·`playId`·`songId`가 없다: `level`, `focusPattern`, `counts`(판정 개수), `strengthPad`, `segments`(최대 5개), 같은 사용자·같은 곡의 바로 직전 플레이를 요약한 `history`(없으면 키 없음).
- Nginx는 `^~ /internal/v1/coach-narratives/`를 채보 워커 경로와 같은 IP 허용으로 연다(`Infra/nginx/default.conf`, 본문 64 KiB).
- 시험: `CoachNarrativeQueueTest`(저장·작업 생성, claim 멱등성, result·failure 검증, 임대 만료, 사실의 식별자 제외, 이전 플레이 비교, 노트 구간 필터)와 `CoachSummaryClientTest`(총평 파싱).

## 연주 중 LLM 구간 코칭 작업 (COACH-001)

연주 중 4·8·16마디 구간이 끝날 때 FE가 구간 사실(`facts`)을 보내면, GPU 서버의 워커가 가져가 리포트 총평과 같은 로컬 모델로 안내 칸 문구(`title` 8자, `sub` 20자, V52에서 16자 → 20자)를 써서 제출한다. FE는 짧은 주기로 결과를 조회해 다음 구간에 띄운다. 늦은 답은 쓸모없어서 짧게 살다 지워지는 큐(`live_coach_jobs`, V47)다. 계약과 가드레일은 AI `AI/docs/live-coach-llm.md`.

- **켜기:** `LIVE_COACH_LLM_ENABLED`(기본 `false`). 꺼져 있으면 요청이 204로 끝나고 아무것도 저장하지 않는다. FE는 실험 설정(`coach-live-config`의 `llm`)도 따로 본다.
- **상한:** 판당 `LIVE_COACH_LLM_PER_RUN`(기본 10), 사용자당 1분 `LIVE_COACH_LLM_PER_MINUTE`(기본 6). 넘으면 429. 판은 FE가 판마다 만드는 임의 번호(`runId`)로 센다(`playId`가 아니다).
- **습관 개인화:** `LIVE_COACH_HABIT_ENABLED`(기본 `false`). 켜면 `LiveCoachHabit`이 그 사용자의 최근 분석된 `RHYTHM`·`SHEET` 플레이 10개(`reports.weak_segments`)에서 3판 이상·40% 이상 나온 약점을 최대 2개 골라 `facts.habit`(`plays`, `items[]`: `pattern`, `pad` 또는 `hand`, `share` `OFTEN`·`SOMETIMES`)에 붙인다. 분석된 플레이가 3개 미만이면 붙이지 않는다. 숫자 비율·날짜·곡·`playId`는 넣지 않는다. FE가 보낸 `habit`은 켜고 끄기와 관계없이 지운다. 크기 상한 4096바이트는 FE가 보낸 부분(`habit` 제외)에 건다. 이번 구간과 맞대는 일은 워커가 한다(AI `AI/docs/live-coach-llm.md` "습관 개인화"). 끄면 코드 배포 없이 원래대로다(`api` 재시작).
- **사실:** 객체, `contractVersion` 1, 4KB 이하만 받는다. 내용은 해석하지 않고 워커에 그대로 넘긴다. FE가 타격 원본·`playId`·곡 정보를 넣지 않는다.
- **수명:** 워커는 만들어진 지 30초 안의 작업만 가져가고(그보다 오래되면 실패로 닫음), 임대 15초·시도 1번. 사용자 조회는 60초까지, 5분이 지난 행은 다음 요청 때 지운다.

사용자 API(로그인 필요):

| 호출 | 요청 | 응답 |
| --- | --- | --- |
| `POST /api/v1/live-coach/segments` | `{runId, facts}` | 202 `{requestId, expiresAt}`. 꺼짐 204, 상한 초과 429, 잘못된 사실 400 |
| `GET /api/v1/live-coach/segments/{requestId}` | — | 대기 중 202 `{status}`, 완료 200 `{status:DONE, title, sub, model, generationMs}`, 실패·만료 410, 남의 요청·없음 404 |

워커 API(채보·총평 워커와 같은 Bearer 토큰, `/internal/**`):

| 호출 | 요청 | 응답 |
| --- | --- | --- |
| `POST /internal/v1/live-coach-jobs/claim` | `{workerId, claimRequestId}` | 작업이 없으면 204. 있으면 `{jobId, attemptId, leaseExpiresAt, facts}`. 같은 워커·같은 `claimRequestId`는 같은 배정 |
| `POST /internal/v1/live-coach-jobs/{jobId}/result` | `{attemptId, title, sub, model, generationMs}` | `{status: DONE}`. `title` 1~8자, `sub` 0~20자, 제어 문자 없음, `model` 37자 이하, `generationMs` 0~60,000 |
| `POST /internal/v1/live-coach-jobs/{jobId}/failure` | `{attemptId, code, summary}` | `{status: FAILED}`. `code`는 `INPUT_INVALID`·`MODEL_FAILED`·`OUTPUT_INVALID`(재시도 없음) |

- Nginx는 `^~ /internal/v1/live-coach-jobs/`를 채보·총평 워커 경로와 같은 IP 허용으로 연다.
- 시험: `LiveCoachQueueTest`(요청·claim·result·조회, claim 멱등성, 남의 요청 404, 판당·분당 상한 429, 잘못된 사실, 실패·만료 410, 오래된 작업 미배정, 결과 길이 검증과 임대 확인, 꺼짐).

## 곡 추천 R1: 규칙 추천

공용 곡 중 "지금 치기 좋은 채보"를 규칙 점수로 골라 이유와 함께 돌려준다. 학습·AI 호출이 없고 요청 시 DB의 본인 기록과 공용 곡만 읽는다. 추천 단위는 채보(곡+난이도)이고 응답은 곡당 하나다.

### 채보 특징 (V33 `chart_features`)

- 채보별 **최신 버전**의 평균 밀도(`avg_notes_per_sec`, 곡 길이 기준), 2초 창 최대 노트 수(`peak_notes_2s`, `SongLevelService`와 같은 창), 패드 비율, 상위 12개 패드 전환 비율을 미리 계산해 저장한다(`chart-features-1`).
- `SongLevelService.process(..., apply=true)`가 난이도를 저장하면 `SongChartsChanged`를 발행하고, **커밋 뒤** `ChartFeatureListener`가 새 트랜잭션에서 계산한다. 계산이 실패해도 채보 생성·난이도 산정은 성공이고, 특징이 없는 채보는 추천 후보에서만 빠진다.
- 앱이 준비되면 `ChartFeatureBackfillStartup`이 특징이 없는 기존 채보를 채운다(`chart-features.backfill.enabled=false`로 끈다. 테스트 기본값). 이미 현재 버전으로 저장된 채보는 건너뛰므로 여러 번 돌려도 같다.

### 리듬 격자 (V35 `chart_features.rhythm_grid`, 지금은 저장만 하고 R2 점수에 쓰지 않음)

- 패드 묶음(`KICK`·`SNARE`·`HAT`=HIHAT·HIHAT_PEDAL·`CYMBAL`=CRASH·RIDE·`TOM`)마다 **한 박을 12칸으로 나눈 위치별 비율**(합 1, 노트 없는 묶음은 전부 0)과 `bpm`·`timeSignature`·`unquantizedRatio`를 JSON으로 저장한다. 12칸은 8분·16분·셋잇단음표를 모두 담는다. 위치는 `(timeMs - offsetMs) / (60000 / bpm)`의 소수부를 가장 가까운 칸에 맞춰 구한다.
- **제외 표시:** 가변 템포(`tempoMap`에 다른 BPM이 둘 이상)는 `{"excluded":"VARIABLE_TEMPO"}`, 칸에서 1/48박 넘게 벗어난 노트가 20%를 넘으면 `OFF_GRID`, 박자 정보가 망가졌으면 `INVALID_TIMING`, 아는 패드가 없으면 `NO_KNOWN_PADS`를 저장한다. 제외된 채보도 값이 저장되므로 백필이 반복 계산하지 않는다.
- `feature_version`은 `chart-features-1` 그대로다. `rhythm_grid`가 NULL인 행(V35 이전에 저장된 행)만 백필과 난이도 저장 뒤 계산이 채우고, 기본 특징은 같은 값으로 다시 쓰이므로 R1 추천은 영향이 없다. 박자 정보가 망가진 채보도 기본 특징은 저장한다.
- 시험: `RhythmGridTest`(칸 위치, 묶음, 오프셋, 제외 사유, 결정성)와 `ChartFeatureRhythmGridTest`(DB: 격자 저장·재호출 무계산, 제외 표시, 격자만 채우기. CI에서 돈다).

### 비슷한 곡 R2 (V36, `song/similar/`)

`GET /api/v1/songs/{songId}/similar?difficulty=EASY|NORMAL|HARD&size=` (Bearer 인증, `size` 1~10 기본 5, `difficulty` 기본 NORMAL). 기준 곡과 연주 느낌이 비슷한 공용 곡을 곡당 채보 하나로 돌려준다. 응답 `{requestId, strategy: "SIMILAR_V1", items[{song, chartId, difficulty, similarity(0~1), matchedOn[]}]}`. AI 서버를 부르지 않는다.

- **기준 곡:** 공개된 공용 곡이거나 본인 곡. 없는 곡·타인의 개인 곡은 404 `SONG_NOT_FOUND`. 기준 채보는 요청한 난이도, 없으면 EASY·NORMAL·HARD 순서에서 가장 가까운 것(같은 거리면 쉬운 쪽). 기준 곡에 리듬 격자가 없으면(가변 템포·격자 이탈·아직 계산 전) 오류가 아니라 200과 빈 `items`다.
- **후보:** R1과 같은 공용 곡 조건에 채보 특징이 있는 최신 버전 채보. 개인 곡은 결과에 나오지 않는다. 후보 채보 목록은 `similar.cache-ttl-seconds`(기본 300, 0이면 끔) 동안 프로세스 안에 캐시한다. 사용자와 무관한 값이다.
- **유사도(`SimilarityEngine`, 가정값):** 패드 구성 0.31 + 전환 0.23 + 밀도 0.23 + 템포 0.23. 리듬 격자는 점수에 쓰지 않는다(공용 곡의 절반 가까이가 격자를 만들 수 없어서, `rhythm_grid` 값은 계속 저장한다). 템포와 박자표는 `songs`에서 읽고, 모르는 쪽이 있으면 박자표 감점을 하지 않는다. 박자표 분자가 다르면 ×0.5, 0.5 미만은 제외. 같은 입력이면 같은 값·순서(같은 점수는 곡 id순). 사용자 기록은 점수에 쓰지 않는다.
- **본인 기록 필터:** R1의 기준 밀도(최근 85% 이상 연주의 밀도 최댓값)가 있으면 그 1.5배를 넘는 채보는 거른다. 기록이 없으면 거르지 않는다.
- **메타데이터(255번):** 기준·후보 채보에 `song_metadata`를 붙여 엔진에 넘긴다. 양쪽 곡에 있을 때만 15%를 섞고(엔진 규칙), 한쪽이라도 없으면 채보 유사도만 쓴다. 장르는 대표+보조 장르를 합친 집합이다. 메타 기여가 요소당 약 0.04라 `matchedOn`에 `GENRE`·`MOOD`·`DRUM_STYLE`·`ENERGY`는 거의 나오지 않는다(FE는 모르는 코드를 문구 없이 처리). 후보 캐시 때문에 메타데이터 변경은 최대 `similar.cache-ttl-seconds` 뒤에 반영된다.
- **기록:** 호출마다 `recommendation_items`에 `context=SIMILAR`, `strategy=SIMILAR_V1`, `source_song_id`(기준 곡), 점수(유사도), `reason_codes`(`matchedOn`)로 노출을 남긴다. 클릭은 R1과 같은 `POST /api/v1/recommendations/{requestId}/clicks`. 보관 정리·탈퇴 삭제도 R1과 같다.
- 시험: `SimilarityEngineTest`(순수 계산), `SimilarSongsServiceTest`(후보 조건, 개인 곡·기준 곡 제외, 격자 없는 곡 포함, 특징 없는 곡은 빈 결과, 404, 본인 기록 필터, 노출·클릭. 임베디드 DB가 필요해 CI에서 돈다).

### 연습 추천 (`context=DRILL`, V40, `DrillPlanner`)

`GET /api/v1/songs/recommendations?context=DRILL&playId=&size=` (Bearer 인증). 그 연주의 약점에 맞는 공용 곡을 약점 종류마다 하나씩, 최대 3개 돌려준다. `playId`는 필수이고(없으면 400) 본인 연주만 된다(404 `PLAY_NOT_FOUND`). 약점이 없거나 분석 전·실패면 200과 빈 `items`다. AI 서버를 부르지 않는다.

- 응답: R1과 같고 `strategy`는 `DRILL_V1`이다. 항목에 `focus: {pattern, pads}`가 더 있다. 이유 코드는 `DRILL_TRANSITION`, `DRILL_PAD`, `DRILL_MISS`, `DRILL_TIMING`이다.
- 규칙(가정값): 전환 약점은 그 방향의 전환이 있는 곡, 패드 약점은 그 패드를 치는 곡, 놓침 약점은 놓친 패드를 치는 곡, 타이밍·불안정 약점은 밀도가 낮은 곡을 고른다. `HAND_WEAK`는 채보에 손 정보가 없어 건너뛴다.
- 점수: `0.6 × 후보 내 순위 + 0.4 × 밀도 적합도`. 좋게 보는 밀도는 기준 밀도의 0.6~1.0배(전환·패드), 0.5~0.85배(놓침·타이밍)다. 1.25배를 넘는 채보는 뺀다. 기준 밀도가 없으면 방금 친 채보의 밀도를 쓴다.
- 방금 친 곡과 개인 곡은 나오지 않는다. 전환 비율은 채보별 상위 12개만 저장하므로 드문 전환은 결과가 비어 있을 수 있다.
- 기록: `recommendation_items`에 `context=DRILL`, `strategy=DRILL_V1`. 클릭은 R1과 같은 호출이다. 리포트의 `recommendedDrills`는 쓰지 않고 null로 둔다.

### 조회와 기록

| 호출 | 설명 |
| --- | --- |
| `GET /api/v1/songs/recommendations?context=SONG_PICKER\|REPORT&mode=RHYTHM\|SHEET&playId=&size=` | Bearer 인증. `size` 1~10(기본 5). 응답 `{requestId, strategy: "RULE_V1", items[{song, chartId, difficulty, reasons[{code, text}]}]}`. 후보가 없으면 200과 빈 `items`. `playId`는 `context=REPORT`에서만 쓰며(아니면 400) 본인 연주가 아니면 404 `PLAY_NOT_FOUND` |
| `POST /api/v1/recommendations/{requestId}/clicks` | 본문 `{songId}`. 204. 같은 카드를 다시 눌러도 첫 시각을 유지한다. 없는 추천·타인의 추천·그 추천에 없는 곡은 404 `RECOMMENDATION_NOT_FOUND` |

- 후보: 공개된 BUILTIN 공용 곡 중 READY·곡 난이도 산정 완료·미삭제, 최신 버전에 특징이 있는 채보. 개인 곡은 넣지 않는다. 악보 이미지 유무(`notation_status`)는 추천에 쓰지 않는다. 악보 연습은 채보 노트로 그리기 때문이다. `mode`는 값을 검사만 하고 결과에는 영향을 주지 않는다. 곡 목록의 중복 제거 규칙과 같게 NORMAL과 노트 수가 같은 채보는 뺀다.
- **기준 밀도:** 최근 1배속 RHYTHM·SHEET 연주 10판 중 정확도 85% 이상인 판의 채보 밀도 최댓값. 기준이 없으면(기록 없음, 또는 85% 이상이 없음) BEGINNER 곡의 가장 쉬운 채보를 `STARTER` 이유로 보여 준다. 기준의 1.5배를 넘는 채보는 점수와 무관하게 제외한다.
- **점수(가정값, `RecommendationScorer`):** 난이도 적합도 0.45(기준의 1.10~1.25배에서 최고점) + 약점 0.30 + 새로움 0.15(안 친 곡 1, 14일 넘게 안 친 곡 0.5) + 재도전 0.10(최고 정확도 70~85% 미만). 같은 점수는 곡 id, 채보 id 순으로 가려 같은 입력이면 같은 순서다. 이유 코드는 `CHALLENGE`·`WEAK_PAD`·`NEW_SONG`·`RETRY`·`STARTER`이고 항목마다 하나 이상이다. 같은 대표 이유는 전체의 절반 이하로 두되 후보가 모자라면 남는 자리를 순서대로 채운다.
- **약점:** 최근 5개 리포트의 `PAD_LATE`·`PAD_EARLY`·`MISS_CLUSTER` 약점의 `pads`를 `metrics.severity` 가중치로 모은다(오래될수록 0.8배씩 감소, `playId`를 주면 그 연주를 그대로 쓰고 나머지는 절반). 분석이 끝나지 않은 리포트(`weak_segments` null)는 건너뛴다. 전환 약점(`TRANSITION_*`)은 `pads` 순서가 방향인지 확인되지 않아 쓰지 않는다.
- **기록(V34 `recommendation_items`):** 조회할 때마다 노출을 남긴다(`request_id`, `rank`, 위치, 전략, 곡·채보, 점수, 이유 코드, `shown_at`). 클릭은 `clicked_at`. 90일이 지난 기록은 `RecommendationRetention`이 하루에 한 번 지운다(`recommendation.retention-days`). **회원 탈퇴 트랜잭션에서 그 회원의 기록을 같이 지운다**(`WithdrawalService`).
- 시험: `ChartFeaturesTest`·`RecommendationScorerTest`(순수 계산: 밀도·창·전환, 1.5배 제외, 곡당 하나, 약점 가중, 새로움·재도전, 다양성, 결정적 순서)와 `RecommendationServiceTest`(커밋 뒤 특징 저장, 개인 곡 제외, STARTER, 타인의 `playId` 404, 노출·클릭, 보관 정리. 임베디드 DB가 필요해 CI에서 돈다).

## 리포트 약점 분석 (158번 후속)

신규 RHYTHM/SHEET 플레이의 세션·전체 타격·기본 리포트를 함께 저장한 뒤 별도 작업에서
AI `POST /analysis/weak-segments`를 호출한다. 업로드와 기본 리포트는 AI 응답을 기다리지 않는다.
`AI_ANALYSIS_BASE_URL` 기본값은 `http://ai-api:8000`이며 로컬 AI 시험 시 해당 서버 주소로 바꾼다.
요청에는 `playbackRate`(미기록이면 1), 저장된 판정 폭과 MISS·여분 타격을 포함한 전체 hits를 전달한다. 입력이 AI의 5 MiB 한도를
넘으면 자르지 않고 실패 처리한다. 연결 1초·응답 3초이며 연결 실패·시간 초과·5xx만 한 번 더 시도한다.

`analysisStatus`는 PENDING → DONE 또는 FAILED다. DONE의 빈 `weakSegments`는 분석 결과가 비어 있음을
뜻하며 표본 부족도 포함한다. 실패는 null이다. `generatorVersion`에는 기존 BE 버전과 분석기 버전을
함께 기록한다. 이전 NOT_REQUESTED 리포트는 자동 재분석하지 않는다. V18은 처리 시도 수와 임대를
저장하므로 프로세스 종료 후 잔류 작업을 회수하며, 전체 시도는 최대 2회다. 명확한 일시적·복구 가능한 DB 예외도 같은 재시도 예산을 사용하며 그 밖의 런타임 오류는 실패 처리한다. 재시도는 최소 2초 후 다음 회수 주기(기본 10초)에 시작한다. 타임아웃 이후 늦게 도착한
결과는 임대 토큰이 일치할 때만 반영한다. 요청 본문·playId는 분석 로그에 남기지 않는다.

## 약점 분석 보정용 비식별 내보내기 뷰 (142번)

AI 약점 분석 임계값 보정 배치가 원본 테이블 대신 읽는 읽기 전용 뷰 `coach_export_v`(V21)와, 이 뷰만 읽을 수 있는
로그인 불가 그룹 역할 `coach_export_reader`다. 뷰의 열 목록이 곧 비식별 허용 목록이며, 열을 늘리려면 AI와 먼저 합의한다.
앱은 이 뷰를 조회하지 않는다.

행 조건:

- `consent = true`, `mode`가 RHYTHM/SHEET인 세션만. 타격(`hits`)이 없는 세션은 행이 없다.
- `users.role = 'ADMIN'`인 회원(팀원)의 세션은 뺀다. 팀원은 운영 `ADMIN_EMAILS`에 등록해 다음 로그인부터 ADMIN이 된다.
- 탈퇴 회원의 세션은 뺀다(V41). 세션 원본은 탈퇴 뒤 삭제되고, 이미 보정 기록에 반영된 집계만 남는다.
- 위 조건을 만족하는 세션 중 회원별 최근 10개(`ended_at` 내림차순). 회원 ID는 순위 계산에만 쓰고 내보내지 않는다.

열(이 순서): `session_key`, `mode`, `input_source`, `song_ref`, `song_origin`, `perfect_ms`, `good_ms`, `difficulty`,
`played_date`, `payload_schema_version`, `seq`, `t_ms`, `stick_id`, `pad`, `velocity`, `peak_accel`, `judgement`,
`matched_note_id`, `delta_ms`. 한 행이 타격 한 건이다.

- `session_key`는 세션 UUID와 세션 설정 `app.export_salt`를 이어 붙인 SHA-256 hex다. 소금이 없는 세션에서는 어떤 열을
  조회하든 `unrecognized configuration parameter`(SQLState 42704)로 실패하고, 빈 문자열이면 행이 나오지 않는다.
- 개인 곡(`songs.owner_id`가 있는 MIDI·AUDIO)은 `song_ref`가 NULL, `song_origin`이 `PRIVATE`다. 공용 곡은 곡 ID와 `PUBLIC`.
- `difficulty`는 채보 버전의 난이도, `played_date`는 `created_at`의 KST 날짜다.
- 뷰는 소유자 권한으로 원본을 읽고 `security_barrier`다. 그룹 역할에는 스키마 USAGE와 뷰 SELECT만 있다.

운영 적용(Infra, 비밀 값은 저장소에 두지 않는다):

1. 배포 시 Flyway가 V20·V21을 적용한다. 그룹 역할 생성에는 앱 DB 계정의 `CREATEROLE`(현재는 슈퍼유저)이 필요하다.
2. 접속 계정을 만든다. `CREATE ROLE coach_export LOGIN PASSWORD '…'`(이름은 자유).
3. `GRANT coach_export_reader TO coach_export`.
4. `ALTER ROLE coach_export SET app.export_salt = '…'`. 빈 문자열은 쓰지 않는다. 소금을 바꾸면 `session_key`가 모두 바뀐다.
5. 운영 `.env`의 `ADMIN_EMAILS`에 팀원 로그인 이메일을 넣고 재기동한다.

배치는 `SELECT * FROM coach_export_v ORDER BY session_key, seq`를 한 번 서버 커서로 읽는다. 뷰는 조회마다 다시 계산하며,
동의가 바뀌거나 탈퇴로 세션이 지워지면 다음 조회부터 빠진다.

`CoachExportViewMigrationTest`가 V20(기존 행 보존·길이 16·HIHAT_PEDAL 저장)과 V21(열 목록, 행 조건, 최근 10개, 개인 곡,
KST 날짜, 소금 변경·부재, 그룹 역할의 원본 접근 거부, 같은 클러스터 재적용)을 검사한다.

## 탈퇴 후 곡·파일 정리 (37번)

회원 탈퇴 커밋 후 개인 MIDI·AUDIO 곡을 소프트 삭제하고 반주와 기존 악보 이미지의 정리 작업을 등록한다. 공용 곡과 다른 회원 곡, 동의한 플레이 기록은 보존한다. 작업 취소는 기존 워커 경로를 사용한다. 누락된 이벤트는 주기적으로 전체 탈퇴 곡을 순회해 복구하며, 저장소 삭제 실패는 재시도한다. 잘못된 귀속 키는 삭제하지 않고 오류를 기록한다. 이미 발급한 URL은 만료 전까지 유효할 수 있다.

정리 작업자는 `CHART_ASSET_ENABLED`, endpoint와 `CHART_ASSET_SHEET_BUCKET` / `CHART_ASSET_ACCOMPANIMENT_BUCKET`을 사용한다. `WORKER_STORAGE_ACCOMPANIMENT_WRITE_ACCESS_KEY` / `WORKER_STORAGE_ACCOMPANIMENT_WRITE_SECRET_KEY` (미지정 시 AUDIO 저장소 자격 증명)을 두 버킷에 대한 삭제 권한이 있는 자격 증명으로 설정한다. 조회 전용 `CHART_ASSET_ACCESS_KEY`는 삭제에 쓰지 않는다. 정리가 비활성화되면 작업이 대기 상태로 남고, 활성화된 저장소의 미설정·삭제 권한 오류는 실패로 기록해 재시도한다. 실제 저장소 권한 검증은 별도로 필요하다.

## 텔레메트리 수신·조회 (152번)

MONITOR-001 진단 텔레메트리. 스틱 → 브라우저 → 판정 → 오디오 스케줄 구간 지연과 연결 상태를 세션 단위로 남겨, 연주가 끝난 뒤 지연 통계·연결 방식 비교에 쓴다.
점수·플레이 리포트·AI 약점 분석의 원본이 아니며(유실 허용), 연주 중 실시간 확인은 FE 로컬 모니터가 맡는다.
계약은 2026-10-27 BE 간 합의(REST 배치·ADMIN 진단 모드 한정·무재전송)를 따르며 FE 동의는 187번에서 진행 중이다.

세 API 모두 Bearer 인증과 **ADMIN 역할**이 필요하다(`@PreAuthorize`). 미인증·만료·탈퇴는 401, USER는 403 `FORBIDDEN`이다.

| API | 요청 | 응답 |
| --- | --- | --- |
| `POST /api/telemetry/batches` | JSON 본문 128 KiB 이하, 이벤트 1~100건 | 200 `{acceptedCount}`. 배치 전체를 한 트랜잭션으로 저장 |
| `GET /api/telemetry/sessions` | `from`·`to`(ISO-8601, 기본 지금까지 최근 7일, 최대 31일), `userId`(선택), `page`(0~), `size`(1~100, 기본 20) | `PageResponse<{userId, sessionId, mode, firstEventTime, lastEventTime, eventCount, hitCount, statusCount, conditions}>`, lastEventTime 내림차순. `conditions`는 [측정 조건](#측정-세션-실험-조건-259번)이며 받은 적 없으면 null |
| `GET /api/telemetry/sessions/{sessionId}/events` | `userId`(필수), `kind`(`HIT`·`STATUS`, 선택), `page`, `size`(1~1000, 기본 500) | `PageResponse<이벤트>`, time 오름차순(같은 시각은 stickId 0·1·null). 없는 세션은 빈 페이지 |

요청 외피는 `schemaVersion`(1), `sessionId`(UUID), `mode`(`RHYTHM`·`FREE`·`TEMPO`·`SHEET` 또는 null), `events`, 선택 객체
`conditions`([측정 조건](#측정-세션-실험-조건-259번))다. `userId`는 받지 않고 인증 주체로 저장한다. 같은 `sessionId`를 다른 회원이 보내도 조회는 항상 `(userId, sessionId)`로 나뉜다. `play_sessions` 존재는 검사하지 않는다.

| 이벤트 필드 | HIT | STATUS |
| --- | --- | --- |
| `time`(ISO-8601 문자열), `kind`, `tags` | 필수 | 필수 |
| `stickId`(0·1) | `tags.source`가 `keyboard`가 아니면 필수 | 필수 |
| `pad`·`baselinePad`·`predictedPad` | 선택. wire 9종 `CRASH` `HIHAT` `SNARE` `SMALL_TOM` `MID_TOM` `FLOOR_TOM` `RIDE` `KICK` `HIHAT_PEDAL` | null |
| `judgement`·`deltaMs` | PERFECT·GOOD이면 deltaMs 필수, 판정 없음·MISS이면 deltaMs null | null |
| `velocity`(0~127 정수), `tRecv`·`tJudge`(ms) | 필수 | null |
| `tAudio`(ms) | 선택 | null |
| `tSensor`(정수 µs, 0 이상), `clockOffsetMs`, `packetLoss`(0~1), `batteryPct`(0~100 정수) | 선택 | 선택 |

- `tags`는 1 KiB 이하 객체이고 키는 `source`(필수, 1~32자), `clockSynced`(boolean, HIT 필수), `connected`(boolean, STATUS 필수),
  `firmware`(1~64자)만 받는다.
- 선택 필드의 부재와 null은 같다. BE는 null을 0으로 채우거나 계산하지 않는다(동기화 전 `clockOffsetMs`=null 등).
- 숫자는 JSON 숫자 토큰만 받는다. 정수 자리의 소수(`96.0`), 문자열 숫자, 유한하지 않은 값(`1e999`), 서버 시각보다 5분 넘게 미래인 `time`은 거절한다.
- 이전 `HI_TOM` 입력도 받으며 새 행에는 `SMALL_TOM`으로 저장한다. 기존 `HI_TOM` 행은 변경하지 않고 세 패드 필드 조회 시 `SMALL_TOM`으로 반환한다.
- 계약 밖 필드(`rawWindow` 등)·중복 키·목록 밖 패드는 거절한다.

| 상태 | `code` | 경우 |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | 본문 파싱 실패·모르는 필드(`conditions` 안은 예외)·타입 불일치·목록 밖 enum. detail에 `events[0].pad`·`conditions.sensorMount` 같은 위치만 담는다 |
| 400 | `TELEMETRY_SCHEMA_UNSUPPORTED` | `schemaVersion`이 1이 아님 |
| 400 | `TELEMETRY_EVENT_INVALID` | 위 규칙 위반, 빈 `events`, `conditions`의 길이·범위 위반. detail은 `events[i].필드: 이유`·`conditions.필드: 이유`이며 값은 넣지 않는다 |
| 400 | `VALIDATION_FAILED` | 조회 페이지·기간 범위 밖 |
| 413 | `TELEMETRY_BATCH_TOO_LARGE` | 본문 128 KiB 초과(Content-Length가 없어도 읽는 도중 끊음) 또는 이벤트 100건 초과 |
| 500 | `INTERNAL_ERROR` | DB 저장 실패. 이미 넣은 행도 모두 롤백하며 로그에는 예외 클래스명만 남긴다 |

한 건이라도 거절되면 그 배치의 어떤 행도 저장하지 않는다. 재전송·멱등 처리는 없으므로 FE는 실패한 배치를 다시 보내지 않는다.
요청 횟수 제한(429)은 MVP에서 구현하지 않는다(행에는 이름·이메일이 없고 회원 번호만 있다).

### 측정 세션 실험 조건 (259번)

MONITOR-002. 세션끼리 "어떤 조건에서 쟀는지"를 비교하기 위한 환경 정보다. 필드·값은 FE가 EMB와 맞춰 확정했다(`MONITOR-002_측정세션-실험조건`, 2026-11-06).

배치 외피의 선택 객체 `conditions`로 받는다. **FE는 같은 `sessionId`의 매 배치에 그 시점의 전체 값을 붙이고**, BE는 `telemetry_session_conditions`(V39)의
`(user_id, session_id)` 한 행을 **마지막으로 받은 값으로 통째로 바꾼다**(null이 된 값은 null이 된다). `conditions`가 없거나 null인 배치는 행을 건드리지 않는다.
조건이 바뀌어도 세션을 나누지 않으며 BE는 세션 경계를 판단하지 않는다. 저장은 이벤트와 같은 트랜잭션이라 조건만 남고 이벤트가 롤백되는 일은 없다.
`conditions`도 본문 128 KiB 상한에 들어간다. `schemaVersion`은 1 그대로다.

| 필드 | 타입 | 규칙 |
| --- | --- | --- |
| `firmware` | `{"0": 문자열 또는 null, "1": 문자열 또는 null}` 또는 null | 스틱별 펌웨어(0 왼손·1 오른손, `"{major}.{minor}"`). 각 1~64자. 아직 STATUS를 못 받은 스틱은 null |
| `dongleFirmware` | 문자열 또는 null | 동글 펌웨어 1~64자. 블루투스 직결이면 null |
| `linkMask` | 정수 또는 null | 동글 LINK 연결 마스크 0~15(bit0 왼손, bit1 오른손, bit2 왼발 페달, bit3 오른발 페달) |
| `hapticEnable` | boolean 또는 null | 스틱 타격 진동 켬/끔. FE가 값을 확인했을 때만 채운다 |
| `sensorMount` | `GRIP_FRONT`·`BENCH` 또는 null | 센서 부착 위치. `GRIP_FRONT`는 하우징 안 그립 앞(시제품 유일 위치), `BENCH`는 하우징 없이 책상·손에 둔 시험용 |
| `appBuild` | 문자열 또는 null | FE 빌드 식별자 1~64자 |
| `note` | 문자열 또는 null | 측정자 메모 0~200자(빈 문자열 허용) |

- **`conditions` 안의 모르는 키는 무시한다**(`firmware` 안도 같다). EMB가 필드를 더할 때 FE를 먼저 배포할 수 있게 하기 위해서다. 외피·이벤트 `tags`의 모르는 키는 지금처럼 400이다.
- 정의된 키의 값이 잘못되면 배치 전체를 거절한다. 타입·목록 밖 값(`"3"`, `3.0`, `TIP`, 문자열 자리의 숫자)은 파서가 400 `INVALID_INPUT`, 길이·범위는 400 `TELEMETRY_EVENT_INVALID`(`conditions.linkMask: 0~15 정수여야 합니다`).
- 값을 보정하지 않는다. 1~64자 필드의 빈 문자열은 거절하고 `note`의 빈 문자열은 그대로 저장한다.
- 세션 목록 응답의 `conditions`는 요청과 같은 모양이다. 조건을 받은 적 없는 세션은 null, 모든 값이 null인 조건은 필드가 null인 객체이며 `firmware`는 언제나 `"0"`·`"1"`을 가진 객체다. 이벤트 조회 응답은 바뀌지 않는다.
- 조건별 비교·필터 조회는 없다(Jira 259 보류). 조건 수정·삭제 API도 없다.

**배포 순서:** 텔레메트리 파서는 모르는 외피 필드를 거절하므로, **이 버전이 배포되기 전에 FE가 `conditions`를 보내면 그 배치는 모두 400으로 버려진다.**
FE 전송(2026-11-10 예정)보다 BE를 먼저 배포한다. 반대 순서는 서비스 장애는 아니지만(유실 허용 계약) 그 기간의 측정이 빈다.

### 보관·탈퇴 (258번)

MONITOR-002. 기준은 Infra와 합의했다(`MONITOR-002_텔레메트리-보관-정책`, 2026-11-04).

| 항목 | 기준 |
| --- | --- |
| 보관 기간 | **90일.** V30의 TimescaleDB 보관 정책이 매일 1회, 범위 끝이 90일보다 오래된 1일 청크를 통째로 지운다. 실제 보관 상한은 90일 + 최대 하루 |
| 탈퇴 | 탈퇴 트랜잭션(`domain.withdrawal.service.WithdrawalService`) 안에서 그 회원의 행을 모두 지운다(`DELETE … WHERE user_id = ?`). 실패하면 탈퇴 전체가 롤백된다. 탈퇴 로그에 `deletedTelemetry` 건수가 남는다 |
| 압축 | 두지 않는다. 용량이 작아(팀 테스트 4주 0.5 GB 안팎) 관리 부담이 더 크다. 운영 크기가 예상보다 크면 다시 정한다 |
| `user_id` 인덱스 | 두지 않는다. 탈퇴 삭제는 청크 순차 스캔이지만 보관 상한·탈퇴 빈도가 작고, 인덱스는 청크마다 생겨 수집 쓰기 비용을 늘린다 |
| 백업 | 이미 만든 `pg_dump` 파일 안의 데이터는 이 정책이 지우지 않는다. 백업 보관 기간은 Infra 백업 정책(133번)에서 정한다 |
| 측정 조건(259) | `telemetry_session_conditions`에는 보관 정책을 두지 않는다(세션당 한 행, 수백 바이트). 이벤트가 지워진 세션은 목록에 나오지 않으므로 남은 행은 보이지 않는다. 탈퇴 때 그 회원의 행을 같은 트랜잭션에서 지운다(`deletedTelemetryConditions` 로그) |

**운영 적용:** 따로 SQL을 실행하지 않는다. 릴리즈 배포 때 Flyway가 V30을 한 번 실행해 정책을 등록한다.
TimescaleDB 백그라운드 작업이 켜져 있어야 정책이 돈다(`SHOW timescaledb.max_background_workers;`가 1 이상, 2026-11-04 운영 16).
배포 뒤 확인:

```sql
-- 정책 job 1개, drop_after 90 days
SELECT job_id, proc_name, schedule_interval, config FROM timescaledb_information.jobs
WHERE hypertable_name = 'telemetry_events';
-- 마지막 실행 시각·결과
SELECT job_id, last_run_started_at, last_run_status, next_start FROM timescaledb_information.job_stats
WHERE hypertable_name = 'telemetry_events';
-- 남아 있는 가장 오래된 데이터
SELECT min(time), max(time), count(*) FROM telemetry_events;
```

**되돌리기·변경:** 앱만 롤백해도 정책은 DB에 남는다. 기간을 바꾸거나 정책을 없애려면 운영에서 직접 SQL을 쓰지 않고
Infra와 합의한 뒤 새 마이그레이션(`remove_retention_policy` 후 다시 등록)으로 한다.

`TelemetryBatchValidatorTest`는 파싱·검증 규칙(259 `conditions`의 모양·길이·범위·모르는 키 무시 포함)을, `TelemetryApiTest`는 실제 JWT·임베디드 PG에서
권한·저장·null 보존·전체 거절·롤백·조회와 259 조건의 저장·통째 교체·행 유지·롤백·세션 목록 응답을, `TelemetrySchemaMigrationTest`는 V17 적용 전후 행 보존과
컬럼 타입, V39의 PK·CHECK를 검사한다. hypertable에서의 V17은 위 TimescaleDB 검사가 확인한다. 탈퇴 시 조건 행 삭제는 `WithdrawalServiceTest`가 본다.

## 곡 추천 R3: 후보 적재와 서빙

AI 배치가 미리 계산한 후보를 저장해 두고 추천 요청 때 R1 규칙으로 거르고 섞는다. 요청 경로에서 AI를 부르지 않는다. **기본은 꺼져 있고, 꺼져 있으면 응답과 기록이 R1과 같다.**

| 호출 | 설명 |
| --- | --- |
| `POST /api/users/me/signup-consent` | 선택 항목 `recommendationConsent: { agreed, version }` 추가. 생략하면 이전 응답을 바꾸지 않는다 |
| `GET /api/users/me/recommendation-consent` | `{ agreed, version, updatedAt }`. 응답한 적 없으면 `agreed=false` |
| `PUT /api/users/me/recommendation-consent` | 본문 `{ agreed, version }`. 끄면 그 사용자의 후보를 같은 트랜잭션에서 지운다 |
| `POST /internal/v1/recommend-candidates` | 워커 토큰. 후보 적재. 응답 `{ accepted, droppedUnknown, droppedNoConsent }` |
| `GET /internal/v1/recommend-candidates/status` | 워커 토큰. `{ modelVersion, generatedAt, usersWithCandidates }` |

- **설정:** `RECOMMEND_R3_ENABLED`(기본 false), `RECOMMEND_R3_ROLLOUT_PERCENT`(0), `RECOMMEND_R3_MAX_AGE_DAYS`(7), `RECOMMEND_R3_RELEVANCE_WEIGHT`(0.75), `RECOMMEND_R3_ACCEPTED_MODEL_VERSIONS`(쉼표 구분, 빈 값이면 적재를 모두 거절), `SIGNUP_CONSENT_RECOMMENDATION_VERSIONS`.
- **서빙 조건:** 켜짐, 롤아웃 대상(사용자 해시), 동의, 허용된 모델, `max-age-days` 안의 후보, 기준 밀도 있음. 하나라도 어긋나면 `strategy=RULE_V1`이다. 후보를 쓰면 `R3_V1`이고, 기준 밀도의 1.5배를 넘는 채보만 있는 곡은 빠지며, 자리가 남으면 R1이 채운다.
- **읽기 뷰(V37, V42, V45):** `recommend_users_v`, `recommend_songs_v`, `recommend_chart_features_v`, `recommend_interactions_v`. `recommend_export_reader` 그룹 역할에만 권한을 준다. **V38 `recommend_song_meta_v`**(AI 선택 입력): 열은 AI 로더와 같은 `song_id, genre, sub_genres, mood, energy, language, drum_style, release_year`뿐이고(다른 열이 있으면 배치가 멈춘다) `recommend_songs_v`에 있는 곡만 낸다. 다중 값은 `;`로 이은 문자열, 빈 목록은 빈 문자열, 모르는 값은 NULL이다. 출처(`source`·`source_note`)는 내보내지 않는다. 접속 역할은 서버에서 만든다.
- **`user_key`:** 동의할 때 만드는 무작위 16진수 32자(`recommendation_user_keys`). `user_id`에서 계산되지 않고, 대응표는 뷰가 소유자 권한으로만 읽는다. 배치 계정은 표를 읽지 못한다. 철회·탈퇴하면 지우고, 다시 동의하면 새 키가 된다. BE는 표로 사용자를 찾을 수 있어 익명이 아니라 가명이다.
- **`completed`:** 연주 시간이 곡 길이의 80% 이상인 판.
- **철회·탈퇴:** 후보 행을 지운다. 뷰는 다음 읽기부터 그 사용자를 뺀다. 철회는 판 검사를 하지 않아 옛 판 화면에서도 된다. 적재는 동의 행과 회원 행을 잠가 철회·탈퇴 뒤에 후보가 남지 않게 한다.
- **보관:** 후보는 생성 후 `RECOMMEND_R3_MAX_AGE_DAYS`(7일)가 지나면 서빙에 쓰지 않고, `RecommendationCandidateRetention`이 한 시간마다 지운다. 실패하면 다음 주기에 다시 지운다.
- **동의 이력:** 응답마다 `user_recommendation_consent_history`에 추가한다. 탈퇴는 철회로 기록한다. 철회·탈퇴일부터 `recommend.consent-history-retention-days`(730일)가 지나면 하루 주기로 지우고, 탈퇴 회원은 현재 상태 행도 함께 지운다. 동의 중인 회원의 이력은 남긴다. 뷰로 내보내지 않는다.
- **노출 기록:** 철회 뒤에도 `recommendation_items`는 보관 기간(90일)까지 남는다. 평가에는 철회 전 기록만 집계로 쓴다.
