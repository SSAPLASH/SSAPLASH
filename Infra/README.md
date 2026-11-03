# Infra

배포 구성과 CI 러너 운영 안내. 서버 전체 구성과 새 서버 구축 절차는 [포팅 매뉴얼](./PORTING.md)에 있다.

## 관련 문서

- [포팅 매뉴얼과 인프라 구성](./PORTING.md) ([구성도](./architecture.svg))
- [서버 접속 가이드와 키·시크릿 보관 규칙](./ACCESS.md)
- [보안 점검 기록](./SECURITY.md)
- [트러블슈팅 기록](./TROUBLESHOOTING.md)

## CI 러너

CI는 EC2의 GitLab Runner에서 실행한다. 개인 PC에 러너를 두지 않는다.

| 항목 | 값 |
| --- | --- |
| 러너 이름 | `ec2-docker` |
| 실행 방식 | Docker executor (Linux) |
| 태그 | `docker` (모든 job이 `.gitlab-ci.yml`의 `default:`에서 이 태그를 쓴다) |
| 태그 없는 job | 받는다 (CI 파일이 아직 반영되지 않은 `main`·`develop-FE`·`develop-AI`·`develop-EMB`의 골격 job을 처리하기 위해) |
| 동시 실행 | 2 |
| 기본 이미지 | `eclipse-temurin:21-jdk` (job에서 이미지를 지정하면 그 이미지를 쓴다) |

### job 구성

| job | 단계 | 내용 |
| --- | --- | --- |
| `lint`, `test`, `build` | lint / test / build | 파트별 스택이 확정되기 전의 골격 |
| `be-test` | test | `BE`에서 `./gradlew --no-daemon test` |
| `be-build` | build | `BE`에서 `./gradlew --no-daemon bootJar` |
| `be-timescale-test` | test | 일회용 TimescaleDB(service)를 붙여 `./gradlew --no-daemon timescaleTest` |

- BE job은 `BE/**/*`, `Infra/docker-compose.yml`, `.gitlab-ci.yml`이 바뀐 경우에만 돈다.
- `be-timescale-test`의 TimescaleDB 이미지 버전은 `Infra/docker-compose.yml`의 `postgres` 이미지와 같아야 한다. 한쪽을 바꾸면 다른 쪽도 바꾼다.
- 로컬(Windows)에서 같은 검증을 하려면 `BE/scripts/Test-TimescaleSchema.ps1`을 쓴다. 이 스크립트는 CI에서 호출하지 않는다.

### 서버 설정

러너 설정 파일은 EC2의 `/etc/gitlab-runner/config.toml`이다. 러너 토큰이 들어 있어 저장소에 두지 않는다.

- 이 파일과 토큰을 채팅, 이슈, 문서에 붙이지 않는다.
- `gitlab-runner list` 출력에는 토큰이 포함되므로 그대로 공유하지 않는다.
- 동시 실행 수, 이미지 pull 정책 같은 값은 위 파일에서 바꾸고 이 문서의 표를 함께 고친다.

### 러너 재등록

토큰이 노출됐거나 러너를 새로 만들 때의 순서다.

1. GitLab의 Settings → CI/CD → Runners에서 기존 러너를 삭제한다.
2. 같은 화면에서 새 러너를 만든다. 태그는 `docker`, **Run untagged jobs는 켠다.**
3. EC2에서 `sudo gitlab-runner verify --delete`로 서버에 남은 옛 설정을 지운다.
4. EC2에서 새 토큰으로 `sudo gitlab-runner register`를 실행한다. 토큰은 서버 터미널에만 입력한다.
5. `sudo systemctl status gitlab-runner`로 동작을 확인하고 GitLab에서 온라인 표시를 확인한다.

## 오브젝트 스토리지 (SeaweedFS)

AWS S3를 쓸 수 없어 서버 안에 S3 호환 스토리지(SeaweedFS)를 Compose로 띄운다. BE는 S3 호환 클라이언트이며 접속 주소만 이 스토리지로 지정한다. 스토리지 포트는 외부에 공개하지 않고, 브라우저는 Nginx를 거쳐 서명 URL로 접근한다.

### 버킷

| 버킷 | 용도 | 접근 | 만료 |
| --- | --- | --- | --- |
| `airdrum-sheets` | 악보 이미지 | 서명 URL | 없음 |
| `airdrum-accompaniments` | 반주 | 서명 URL | 없음 |
| `airdrum-play-raw` | 플레이 원본 | 서버 내부만(Nginx로 전달하지 않음) | 없음 |
| `airdrum-tmp-audio` | 임시 음원(업로드 원본, 드럼 트랙) | 서명 URL | 1일 |

- 버킷은 `seaweedfs-init` 서비스가 만든다. 이미 있으면 건너뛰므로 다시 실행해도 결과가 같다.
- 워커 분리 결과의 `/airdrum-tmp-audio/worker-staging/` PUT은 최대 128MiB를 허용하며, 다른 스토리지 경로는 기존 50MiB 제한을 유지한다.
- 임시 음원은 처리 후 즉시 폐기가 원칙이다(기획 확정). 1일 TTL은 지우지 못했을 때를 위한 보험이다.
- 만료는 S3 수명주기 API가 아니라 SeaweedFS **경로 TTL**을 쓴다. 이 버전에서는 수명주기 API로 규칙을 저장해도 객체에 만료가 붙지 않아 삭제되지 않는다.

### 키

- 읽기용(reader)은 악보·반주 버킷 읽기만 한다(서명 URL 발급용). 쓰기용(writer)은 서버 내부 적재, 플레이 원본, 임시 음원에 쓴다.
- 읽기용 키로 만든 서명 PUT URL은 거부된다. 업로드 서명이 필요하면 쓰기용 키로 만든다.
- 이름이 `OBJECT_STORAGE_*`인 이유: AWS S3가 아니라 서버 안 SeaweedFS(S3 호환)의 접속 키다. 저장소를 바꿔도 이름을 바꾸지 않도록 저장소 이름을 쓰지 않았다.
- 키는 서버 `Infra/.env`의 `OBJECT_STORAGE_READ_ACCESS_KEY`, `OBJECT_STORAGE_READ_SECRET_KEY`, `OBJECT_STORAGE_WRITE_ACCESS_KEY`, `OBJECT_STORAGE_WRITE_SECRET_KEY`에만 둔다. 서버에서 무작위로 만들고(접근 키 `openssl rand -hex 10`, 비밀 키 `openssl rand -hex 24`) 채팅, 이슈, 문서에 붙이지 않는다.
- 키가 비어 있으면 Compose가 실행을 멈춘다.

### 서명 URL과 Nginx

- 공개 주소(`OBJECT_STORAGE_PUBLIC_URL`)는 도메인 루트이며 경로 접두사를 붙이지 않는다. 서명에는 호스트와 경로가 들어 있어 Nginx가 경로를 자르거나 `Host`를 바꾸면 서명이 틀어진다.
- SeaweedFS에 `-s3.externalUrl`로 같은 주소를 지정해 프록시 뒤에서도 서명을 검증한다. 허용 출처(CORS)도 이 주소로 좁힌다.
- HTTPS(S15P31A307-39) 적용 후에는 `OBJECT_STORAGE_PUBLIC_URL`을 `https` 주소로 바꾸고 다시 확인한다.
- Nginx는 경로별 요청 전체 크기를 제한한다: 일반·관리자 MIDI 1088 KiB, 일반·관리자 커버 2112 KiB, 관리자 반주와 `/api/v1/sheets` 51 MiB, `/api/v1/plays`와 `/api/v1/recordings`(녹음 저장) 5 MiB다. 기존 음원 51 MiB, raw 21 MiB, 워커 결과 8 MiB, 워커 staging 128 MiB와 그 외 API 기본 1 MiB도 유지한다. 일반 스토리지 프록시는 50 MiB다. 해당 API 경로의 초과 응답은 기존 `*_TOO_LARGE` 코드의 413 Problem JSON이다. 파일 형식·개별 파일 크기는 BE에서 별도로 검사한다.
- 앞단 Nginx는 API JSON 응답(`application/json`, `application/problem+json`)만 1 KiB 이상일 때 gzip으로 압축한다(압축 수준 5, `Vary: Accept-Encoding`). BE는 응답 압축을 하지 않고, 프론트 정적 파일은 FE 컨테이너(`FE/nginx.conf`)가 압축하며, 음원·이미지·모델은 이미 압축된 형식이라 제외했다. 요청 본문 압축은 지원하지 않는다.
- 로컬 Docker에서 `python Infra/nginx/test_upload_limits.py`를 실행하면 실제 Nginx TLS 설정의 문법·경로별 한도와 내부 경로 차단을 확인한다. 임시 upstream은 본문 전달만 확인하며 BE 검증이나 실제 GPU 접근 검사가 아니다. 초과 요청은 선언된 Content-Length로 거절하므로 전체 본문을 보내지 않는다. 내부 8 MiB 경계만 허용 IP를 완화한 임시 설정 사본으로 검사한다.
- 앱이 스토리지를 쓰는 스위치(`CHART_ASSET_ENABLED`, `PLAY_RAW_ENABLED`)는 기본 꺼짐이다. 켜는 시점은 BE와 확인한다.

### 외부 AI 워커 연결

- Compose의 `AUDIO_STORAGE_PUBLIC_ENDPOINT` 기본값은 `OBJECT_STORAGE_PUBLIC_URL`이다. 외부 GPU에서 접근할 수 있는 `https://k15a307.p.ssafy.io`를 사용하고 BE의 내부 저장소 주소는 유지한다. 실제 DNS·TLS·서명 URL 접근은 배포 환경에서 확인한다.
- HTTPS의 `/internal/v1/chart-jobs/`는 `222.107.238.74`만 허용하고 Nginx의 최대 본문은 8 MiB이며 BE 결과 JSON 상한은 5 MiB다. 워커 API와 서명 URL 스토리지 경로의 접근·오류 로그는 URL의 query 노출을 막기 위해 끄고 BE·저장소 메트릭으로 진단한다. 나머지 `/internal/`과 HTTP의 `/internal/`은 404다. 추가 EC2 포트는 열지 않는다.
- 서버에서 새 워커마다 별도 난수를 화면에 출력하지 않고 비밀 파일로 생성한다(예: `umask 077` 후 `openssl rand -hex 32 > /안전한/경로/worker-token`, `chmod 600 /안전한/경로/worker-token`). 기존 워커와 다른 토큰을 사용한다. 서버의 `Infra/.env`도 권한 600으로 제한하고, 비밀 편집기에서 기존 항목을 보존하며 `CHART_WORKER_CREDENTIALS=기존ID=기존토큰,새ID=새토큰` 형식으로 등록한다. 파일·토큰을 로그나 채팅에 붙이지 않고 AI 담당자에게 승인된 비밀 전달 경로로 전달한다. 반영 시 API 컨테이너를 재생성하고 기존 워커와 새 워커 인증을 확인한다.
- 전송 재시도를 소진한 워커가 heartbeat를 중단하면 임대 만료 후 단계 마감 및 단계별 최대 2회 재시도 안에서만 복구된다. 409·422 또는 이미 DONE이면 재배정을 보장하지 않는다.

### 운영 메모

- 볼륨 슬롯은 자동(`-volume.max=0`)으로 둔다. 버킷마다 볼륨이 여러 개 잡히고 TTL 경로는 전용 볼륨이 필요해, 고정 값이 작으면 TTL 경로 업로드가 `Not enough data nodes found`로 실패한다.
- 이 서비스는 `ports:`로 포트를 공개하지 않는다. Docker는 방화벽(`ufw`) 규칙을 건너뛰므로, 어떤 서비스에도 DB·Redis·스토리지 포트를 `ports:`로 추가하지 않는다.
- 이미지는 `chrislusf/seaweedfs:4.48`로 고정했고 크기는 약 700MB다. 유휴 메모리는 약 80MB다.

### 검증 결과 (2026-10-22)

로컬 Docker와 EC2에서 확인했다.

| 항목 | 결과 |
| --- | --- |
| `seaweedfs` 기동, 버킷 4종 생성, 재실행 시 같은 결과 | 통과 |
| 임시 음원 버킷 객체의 TTL(1일), 다른 버킷은 만료 없음 | 통과 |
| 서명 PUT·GET으로 외부(PC)에서 업로드·다운로드(Nginx 경유) | 통과 |
| 읽기 키로 악보·반주 읽기, 쓰기·다른 버킷 접근 거부 | 통과 |
| 변조된 서명, 만료된 URL, 서명 없는 접근 거부(403) | 통과 |
| 플레이 원본 버킷이 외부에서 접근되지 않음 | 통과 |
| 브라우저 사전 요청(CORS) 응답 | 통과(서버 응답 확인) |

- 실제 웹 화면(브라우저)에서의 업로드·다운로드는 FE 연동 이후 확인한다.

### 실패 시 대안

- 서명 URL이 프록시 뒤에서 맞지 않으면 먼저 `OBJECT_STORAGE_PUBLIC_URL`, Nginx의 `Host` 전달, SeaweedFS의 `-s3.externalUrl`을 점검한다.
- SeaweedFS가 요구에 맞지 않으면 다른 S3 호환 스토리지(예: MinIO)로 바꾼다. BE는 접속 주소와 키만 바뀌므로 코드 변경이 없다.
- 스토리지 없이 임시로 쓰려면 서버 로컬 볼륨에 저장하는 방식이 있으나, 서명 URL이 없어 BE 변경이 필요하다. 최후의 수단이다.

## 약점 분석 보정 배치 (coach-calibration, COACH-003)

동의한 사용자의 비식별 연주 기록으로 약점 분석 임계값 **후보**를 만들어 MLflow에 기록하는 일회성 배치다. 임계값을 자동으로 바꾸지 않는다.
동작·정책·승인 절차는 [AI/docs/coach-calibration.md](../AI/docs/coach-calibration.md)에 있고, 여기에는 운영에 필요한 것만 적는다.

| 항목 | 내용 |
| --- | --- |
| 서비스 | `docker-compose.yml`의 `coach-calibration`. `profiles: ["calibration"]`라서 `up -d`로는 뜨지 않는다 |
| 실행 | `docker compose -p infra run --rm coach-calibration` (`--force` 등 인자는 배치에 그대로 전달된다) |
| 읽는 곳 | DB 뷰 `coach_export_v`만. 전용 읽기 전용 계정 `coach_export`로 접속하고 원본 테이블 권한은 없다 |
| 쓰는 곳 | MLflow(`http://mlflow:5000`, 내부 네트워크). DB에는 쓰지 않는다 |
| 정책 파일 | `AI/configs/coach/`를 `/config`에 읽기 전용으로 마운트한다(서버 이미지에는 정책 파일이 없다). 파일이 없으면 배치가 실패한다 |
| 권한 | 내부 네트워크만, `cap_drop: ALL`, `no-new-privileges`, 메모리 1GiB |
| 상태 줄 | 끝에 `coach-calibration status=OK\|SKIPPED\|FAIL ...` 한 줄. 알림과 점검이 이 줄을 본다 |

**선행 조건 (모두 갖춰져야 의미 있게 돈다)**
1. AI 쪽 배치 코드(`ssaplash_ai.coach_calibration`)가 서버에 배포돼 있다. 아직 배포 전에는 이 서비스를 실행하면 모듈이 없어 실패한다.
2. BE가 뷰 `coach_export_v`와 그룹 역할 `coach_export_reader`(마이그레이션 V21, BE MR !166)를 서버 DB에 적용했다.
3. 서버에서 읽기 전용 로그인 계정을 만들고 그룹 역할에 넣고 소금을 설정했다(비밀 값은 저장소에 없다). 비밀번호는 `.env`의 `COACH_EXPORT_PASSWORD`에 둔다.
4. `.env`의 `ADMIN_EMAILS`에 팀원 로그인 이메일을 모두 넣었다(뷰가 `role = 'ADMIN'` 계정을 제외한다. ADMIN 권한이 같이 부여되는 점은 알고 하는 선택이다).
5. Alloy가 5초 주기 설정으로 다시 떴다. 설정 파일을 마운트해서 쓰므로 `up -d`로는 다시 읽지 않는다: `docker compose -p infra restart alloy`.

`COACH_EXPORT_PASSWORD`가 비어 있으면 배치는 DB에 접속하기 전에 `status=FAIL error=MissingExportPassword`를 남기고 멈춘다. 다른 서비스에는 영향이 없다.

**로그 수집을 위한 대기**: Alloy의 컨테이너 탐색 기본 주기가 1분이라 일회성 컨테이너의 로그를 놓칠 수 있다. 탐색 주기를 5초로 줄였고
(`monitoring/alloy/config.alloy`), 컨테이너가 시작 직후와 종료 직전에 15초씩 기다린 뒤 끝난다. 그래서 한 번 실행에 최소 30초가 걸린다.
첫 실행 뒤 Grafana Explore에서 `{service="coach-calibration"}`로 상태 줄이 실제로 조회되는지 확인한다(서버에서 확인하기 전이다).

### 예약 실행과 알림

**예약 (GitLab 화면에서 한 번 만든다)**
1. Build → Pipeline schedules → New schedule.
2. 설명 `보정 배치`, 간격 `0 4 * * *`(매일 새벽 4시, 시간대는 Seoul), 대상 브랜치 `main`.
3. 변수 `COACH_CALIBRATION` = `true`를 이 예약에만 넣는다. **프로젝트 CI/CD 변수로는 등록하지 않는다**(등록하면 모든 파이프라인이 보정 전용이 되어 다른 job이 빠진다).
4. 예약을 만든 사람이 실패 알림을 받는다. 배포용 보호 러너를 쓰므로 만든 사람이 `main`에서 보호된 러너를 쓸 권한(Maintainer)이 있어야 한다.

이 파이프라인에는 `coach-calibration` job 하나만 생긴다(`.gitlab-ci.yml`의 `.calibration-guard`가 기존 job을 막는다). 서버에 배포된 소스와 `.env`로 실행하고
배포·롤백과 같은 `resource_group`이라 겹쳐 돌지 않는다. 한 번에 최소 30초가 걸린다.

**수동 실행**: Build → Pipelines → Run pipeline, 브랜치 `main`, 변수 `COACH_CALIBRATION=true`. 새 세션이 기준(50개)에 못 미쳐도 돌리려면(예: 정책 파일을 채운 뒤)
`COACH_CALIBRATION_FORCE=true`를 더한다. 서버에서 직접 실행해도 된다: `cd /srv/airdrum/Infra && docker compose -p infra --profile calibration run --build --rm coach-calibration --force`.

**알림 규칙** (`monitoring/grafana/provisioning/alerting/rules-calibration.yaml`, 배치의 상태 줄을 Loki에서 본다)

| 규칙 | 조건 | 처음 상태 |
| --- | --- | --- |
| 약점 분석 보정 배치 실패 | 최근 26시간에 `status=FAIL` 줄이 있다 | 켜짐 |
| 약점 분석 보정 배치 36시간 넘게 실행 기록 없음 | 최근 36시간에 `status=OK` 또는 `SKIPPED` 줄이 없다(로그가 아예 없어도) | **꺼 둠**(`isPaused: true`) |

두 번째 규칙은 예약을 만들고 첫 상태 줄이 Grafana Explore의 `{service="coach-calibration"}`에서 조회되는 것을 확인한 뒤 `isPaused`를 `false`로 바꾸는 MR을 올려 켠다.
켜 두면 예약 전에는 항상 울린다. 알림을 밖으로 보내는 채널은 후속이라 지금은 Alerting 화면에 표시된다.
알림 규칙 파일을 처음 반영한 배포 뒤에는 Grafana 로그에 프로비저닝 오류가 없는지 확인한다(`docker compose -p infra logs grafana`).
