# BE API 서버

관련 작업: [S15P31A307-93 프로젝트 초기화·앱 컨테이너 실행 정의](https://ssafy.atlassian.net/browse/S15P31A307-93),
[S15P31A307-85 공통 응답·예외 처리·Swagger 설정](https://ssafy.atlassian.net/browse/S15P31A307-85),
[S15P31A307-86 회원·소셜 연동 정보 스키마·마이그레이션](https://ssafy.atlassian.net/browse/S15P31A307-86)

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
| DB | PostgreSQL 16, JDBC 드라이버 42.7.x |
| 영속성 | Spring Data JPA (Hibernate 7). 스키마는 만들지 않고 검증만 한다(`ddl-auto: validate`) |
| 마이그레이션 | Flyway 12 (`spring-boot-starter-flyway` + `flyway-database-postgresql`) |
| 테스트 DB | 임베디드 PostgreSQL 16 (`io.zonky.test:embedded-postgres`). Docker 불필요 |

2026-10-19 초기화 시 공식 Spring Initializr의 안정 버전을 사용했다.
기존 설계 문서의 Boot 3.x에서 4.1.1로 변경했다. Java 21과 Gradle 9.x는
[공식 지원 범위](https://docs.spring.io/spring-boot/4.1/system-requirements.html)에 포함된다.
Boot 4는 Jackson 3 및 Spring Security 7을 기준으로 하므로 후속 기능을 추가할 때
3.x용 예제와 패키지·스타터 이름을 혼용하지 않는다.

기동하려면 PostgreSQL 16이 필요하다. 기동할 때 Flyway가 마이그레이션을 적용하고
Hibernate가 엔티티와 스키마를 검증한다. Redis·인증·AI 연동은 해당 기능 작업에서 추가한다.
공통 응답·오류 형식과 OpenAPI 문서는 아래 [API 규약](#api-규약)을, 스키마 변경은
[DB와 마이그레이션](#db와-마이그레이션)을 따른다.

## 로컬 실행

JDK 21을 설치하고 `JAVA_HOME`을 지정한다. IDE의 Project SDK와 Gradle JVM도 21로 맞춘다.
별도 Gradle 설치는 필요 없다.

로컬 PostgreSQL 16을 준비한다. Infra Compose의 `postgres`는 내부 네트워크 전용이라
호스트에서 실행한 앱이 붙을 수 없다. Docker를 쓰면 아래처럼 로컬 전용 컨테이너를 띄운다.
설치형 PostgreSQL 16을 써도 된다. 비밀번호는 각자 정하고 저장소에 남기지 않는다.

```sh
docker run -d --name airdrum-db -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=app -e POSTGRES_DB=app -e POSTGRES_PASSWORD=<로컬 비밀번호> \
  postgres:16-alpine
```

아래 명령은 `BE/`에서 실행한다.

```powershell
# Windows PowerShell: 실제 설치 경로로 지정한다.
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21.0.11'
$env:DB_PASSWORD = '<로컬 비밀번호>'
.\gradlew.bat --version
.\gradlew.bat bootRun
```

```sh
# macOS / Linux: JAVA_HOME을 JDK 21 경로로 지정한 뒤 실행한다.
export DB_PASSWORD='<로컬 비밀번호>'
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

설정은 실행 환경의 환경변수로 전달한다. Spring Boot가 `.env`를 자동으로 읽지는 않는다.
비밀값·개인 설정을 소스에 넣지 않는다. 루트 `.gitignore`가 `.env*`와 키 파일을 제외한다.

## 곡·채보 마이그레이션 (94번)

`src/main/resources/db/migration/V2__create_songs_charts_chart_versions.sql`은
`songs` → `charts` → `chart_versions` 순서로 생성한다. 86번의 실제 V1 다음에 공통 Flyway 설정으로 자동 적용된다.
94번은 회원 테이블이나 DB 연결 설정을 별도로 도입하지 않는다. 운영 DB에 V2만 단독 적용하지 않는다.

- 공용 곡은 소유자가 없고 라이선스가 필수다. MIDI·AUDIO는 소유자 필수, 반주 키는 AUDIO만 허용한다.
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

페이지 응답 `common.response.PageResponse`는 `items`, `page`(0부터), `size`, `totalElements`,
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

공통 코드는 `common.error.CommonErrorCode`에 있다.

| 코드 | 상태 | 언제 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | 본문 파싱 실패, 필수 파라미터 누락, 타입 불일치, 분류되지 않은 4xx |
| `VALIDATION_FAILED` | 400 | `@Valid`·파라미터 제약 실패. `errors` 동반 |
| `UNAUTHORIZED` | 401 | 인증 필요 (Security 작업에서 사용) |
| `FORBIDDEN` | 403 | 권한 없음, 소유자 검사 실패 |
| `NOT_FOUND` | 404 | 없는 경로. 도메인 자원이 없을 때는 도메인 코드 |
| `METHOD_NOT_ALLOWED` | 405 | |
| `NOT_ACCEPTABLE` | 406 | |
| `CONFLICT` | 409 | 도메인 코드가 없을 때의 기본 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | |
| `INTERNAL_ERROR` | 500 | 처리되지 않은 예외, 분류되지 않은 5xx |

도메인 코드는 각 도메인 패키지에 `{Domain}ErrorCode` enum을 두고 `common.error.ErrorCode`를 구현한다.
코드 문자열은 `{도메인}_{상황}` 형식이다 (예: `USER_NOT_FOUND` 404, `SONG_FORBIDDEN` 403).
공통 코드에는 접두사가 없고, 같은 코드 문자열을 두 enum이 쓰지 않는다.

사용 규칙:

- 서비스·컨트롤러는 `BusinessException(errorCode)` 또는 `BusinessException(errorCode, detail)`만 던진다.
  상태·제목은 코드가 정한다. 컨트롤러에 `@ExceptionHandler`를 따로 두지 않는다.
- 요청 본문은 `@Valid`, 쿼리·경로 파라미터는 제약 애너테이션(`@Min` 등)을 직접 붙인다.
  검증 메시지는 `Accept-Language`와 무관하게 한국어다.
- Spring MVC 밖(서블릿 필터, Security 진입점·접근 거부 핸들러)에서는 `common.error.ErrorResponseWriter`를
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
- Security를 도입하는 작업은 `/v3/api-docs/**`, `/swagger-ui/**`, `/swagger-ui.html`을 permitAll로 둔다.

## DB와 마이그레이션

스키마는 `src/main/resources/db/migration`의 Flyway SQL만 정의한다. Hibernate는 엔티티가
스키마와 맞는지 기동 시 검증만 하므로, 엔티티를 바꾸면 같은 내용의 마이그레이션도 추가해야 한다.

| 버전 | 파일 | 내용 | 작업 |
| --- | --- | --- | --- |
| V1 | `V1__create_users_social_accounts.sql` | `users`, `social_accounts` | -86 |

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

테스트는 임베디드 PostgreSQL 16을 자동으로 받는다. Docker나 로컬 DB가 필요 없고 테스트 클래스에 따로 선언할 것도 없다.
`src/test/resources/META-INF/spring.factories`에 등록된 `support.EmbeddedPostgresInitializer`가
테스트 JVM당 서버를 한 번 띄우고 모든 테스트 컨텍스트의 DataSource로 넣는다. 각 컨텍스트가 뜰 때 Flyway가 마이그레이션을 적용한다.

- 리포지토리·스키마 테스트는 `@DataJpaTest`를 쓴다. 내장 DB로 바꾸지 않도록 설정돼 있어 같은 PostgreSQL을 쓴다.
- 모든 테스트가 같은 DB를 공유하므로 데이터를 남기지 않는다. `@DataJpaTest`는 테스트마다 롤백되고,
  `@SpringBootTest`에서 데이터를 쓰면 `@Transactional`로 롤백하거나 직접 지운다.
- 최초 실행 때 PostgreSQL 바이너리 jar를 Gradle 캐시로 받는다.

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

GitLab의 `be-test`, `be-build`는 BE 또는 CI 파일이 바뀌는 MR과 기존 workflow가 허용하는
통합 브랜치 파이프라인에서 실행된다. 현재는 `local` 태그의 Windows PowerShell shell Runner에서
`gradlew.bat`를 실행한다. `ci/setup-java.ps1`이 공식 Temurin 21.0.12.1+1 Windows 배포 파일을
다운로드하고 SHA-256을 확인한 뒤 작업 폴더의 `.gradle-cache/jdks/`에 준비한다.
작업의 `JAVA_HOME`만 설정하므로 Runner의 시스템 Java 설정은 변경하지 않는다.
JDK는 다음 작업에서도 캐시로 재사용하며, 최초 실행에는 GitHub 배포 파일 다운로드가 필요하다.
shell executor는 `image`를 사용하지 않는다.
Windows에서 긴 Gradle 캐시 경로를 정리할 수 있도록 모든 CI 작업의 Git 프로세스에
`core.longpaths=true`를 환경변수로 전달하며, 호스트의 전역 Git 설정은 변경하지 않는다.
Linux Docker Runner로 전환할 때는 태그·JDK 이미지·Wrapper 실행 명령을 함께 변경한다.
Runner 연결·운영과 CD는 인프라 작업 범위다.

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
(테스트용 임베디드 PostgreSQL은 root로 실행되는 빌드 단계에서 뜨지 않는다). 실행 이미지는 JRE 21과 JAR만 포함한다.
앱은 UID/GID `10001`로 실행한다. 소스 외 파일과 `.env`는 빌드 컨텍스트에 포함하지 않는다.

인프라 Compose 연결 기준:

- 빌드 컨텍스트: `BE/`, Dockerfile: `BE/Dockerfile`
- 컨테이너 수신 포트: `8080`, HTTP
- 상태 확인: `GET /actuator/health`, HTTP 200 및 JSON `status: "UP"` 확인. 응답에는 프로브 그룹 이름도 포함
- 프로세스 확인: `/actuator/health/liveness`, 요청 수신 준비 확인: `/actuator/health/readiness`
- 종료: SIGTERM, 요청 처리 대기 최대 20초. Compose 종료 유예는 30초 이상 권장
- 로그: 표준 출력. 영속 볼륨 불필요
- 운영 공개 진입점은 Nginx로 두고 앱 포트는 내부 네트워크에서 연결

- DB 연결: 환경변수 `DB_URL=jdbc:postgresql://postgres:5432/${POSTGRES_DB}`, `DB_USERNAME=${POSTGRES_USER}`,
  `DB_PASSWORD=${POSTGRES_PASSWORD}`. `postgres`의 healthcheck가 통과한 뒤 기동한다(`depends_on` `service_healthy`)

`/actuator/health`와 readiness는 DB 연결 상태를 포함한다. DB에 붙지 못하면 둘 다 503이고 liveness는 200을 유지한다.
DB가 응답하지 않을 때 503은 커넥션 풀 대기 시간 5초(`spring.datasource.hikari.connection-timeout`)가 지난 뒤에 나온다.
healthcheck의 `timeout`은 5초보다 길게(예: 10초) 둔다. 짧으면 503 대신 시간 초과로 실패한다.
DB를 쓰는 일반 요청도 장애 중에는 5초 안에 500으로 끝난다. DB가 돌아오면 앱 재시작 없이 다시 200이 된다.
기동 시 DB에 접속하지 못하면 Flyway 단계에서 앱이 종료된다. Nginx·DB·Redis Compose와 배포 구성은
[#38](https://ssafy.atlassian.net/browse/S15P31A307-38),
[#47](https://ssafy.atlassian.net/browse/S15P31A307-47)에서 연결한다.
