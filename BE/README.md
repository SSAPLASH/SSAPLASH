# BE API 서버

관련 작업: [S15P31A307-93 프로젝트 초기화·앱 컨테이너 실행 정의](https://ssafy.atlassian.net/browse/S15P31A307-93)

## 기술 스택

| 항목 | 버전·구성 |
| --- | --- |
| Java | 21 LTS |
| Spring Boot | 4.1.1 |
| Gradle | 9.8.1, Wrapper 포함, Groovy DSL |
| HTTP | Spring MVC, 내장 Tomcat |
| 상태 확인 | Spring Boot Actuator |

2026-10-19 초기화 시 공식 Spring Initializr의 안정 버전을 사용했다.
기존 설계 문서의 Boot 3.x에서 4.1.1로 변경했다. Java 21과 Gradle 9.x는
[공식 지원 범위](https://docs.spring.io/spring-boot/4.1/system-requirements.html)에 포함된다.
Boot 4는 Jackson 3 및 Spring Security 7을 기준으로 하므로 후속 기능을 추가할 때
3.x용 예제와 패키지·스타터 이름을 혼용하지 않는다.

현재는 DB·Redis·외부 API 없이 기동할 수 있다. 회원·곡·채보 스키마,
Flyway, 인증, 공통 응답, Swagger와 AI 연동은 해당 기능 작업에서 추가한다.

## 로컬 실행

JDK 21을 설치하고 `JAVA_HOME`을 지정한다. IDE의 Project SDK와 Gradle JVM도 21로 맞춘다.
별도 Gradle 설치는 필요 없다. 아래 명령은 `BE/`에서 실행한다.

```powershell
# Windows PowerShell: 실제 설치 경로로 지정한다.
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21.0.11'
.\gradlew.bat --version
.\gradlew.bat bootRun
```

```sh
# macOS / Linux: JAVA_HOME을 JDK 21 경로로 지정한 뒤 실행한다.
sh ./gradlew --version
sh ./gradlew bootRun
```

기본 주소는 `http://127.0.0.1:8080`이다. 종료는 `Ctrl+C`를 사용한다.

| 환경변수 | 기본값 | 용도 |
| --- | --- | --- |
| `SERVER_ADDRESS` | `127.0.0.1` | 로컬 수신 주소. 컨테이너에서는 이미지가 `0.0.0.0`으로 지정 |
| `SERVER_PORT` | `8080` | HTTP 수신 포트 |
| `JAVA_TOOL_OPTIONS` | JVM 기본값 | 컨테이너 메모리에 맞춘 JVM 옵션이 필요할 때 지정 |

설정은 실행 환경의 환경변수로 전달한다. Spring Boot가 `.env`를 자동으로 읽지는 않는다.
비밀값·개인 설정을 소스에 넣지 않는다. 루트 `.gitignore`가 `.env*`와 키 파일을 제외한다.

## 검증과 패키징

```powershell
.\gradlew.bat clean build
java -jar build/libs/app.jar
```

macOS/Linux에서는 `sh ./gradlew clean build`를 사용한다.
현재 별도 린터는 없으며 `build`가 컴파일·테스트·실행 JAR 생성을 수행한다.
테스트는 실제 HTTP 서버에서 health/liveness/readiness 응답과 관리 엔드포인트 비노출을 확인한다.
결과는 `build/reports/tests/test/index.html`에서 확인한다.

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
docker run --rm --name airdrum-api -p 127.0.0.1:8080:8080 airdrum-api:local
```

다른 터미널에서 `docker stop airdrum-api`로 종료한다.
이미지 빌드 중 테스트와 패키징을 수행하고, 실행 이미지는 JRE 21과 JAR만 포함한다.
앱은 UID/GID `10001`로 실행한다. 소스 외 파일과 `.env`는 빌드 컨텍스트에 포함하지 않는다.

인프라 Compose 연결 기준:

- 빌드 컨텍스트: `BE/`, Dockerfile: `BE/Dockerfile`
- 컨테이너 수신 포트: `8080`, HTTP
- 상태 확인: `GET /actuator/health`, HTTP 200 및 JSON `status: "UP"` 확인. 응답에는 프로브 그룹 이름도 포함
- 프로세스 확인: `/actuator/health/liveness`, 요청 수신 준비 확인: `/actuator/health/readiness`
- 종료: SIGTERM, 요청 처리 대기 최대 20초. Compose 종료 유예는 30초 이상 권장
- 로그: 표준 출력. 영속 볼륨 불필요
- 운영 공개 진입점은 Nginx로 두고 앱 포트는 내부 네트워크에서 연결

현재 readiness는 앱 기동 상태만 확인한다. DB 등 필수 의존성이 생기면 해당 작업에서
연결 상태를 포함할지 결정한다. Nginx·DB·Redis Compose와 배포 구성은
[#38](https://ssafy.atlassian.net/browse/S15P31A307-38),
[#47](https://ssafy.atlassian.net/browse/S15P31A307-47)에서 연결한다.
