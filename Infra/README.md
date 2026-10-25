# Infra

배포 구성과 CI 러너 운영 안내. 서버 전체 구성과 포팅 매뉴얼은 S15P31A307-46에서 이 문서에 이어 쓴다.

## 관련 문서

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
- Nginx의 업로드 크기 한도는 50MB다. BE·AI와 정한 뒤 조정한다.
- 앱이 스토리지를 쓰는 스위치(`CHART_ASSET_ENABLED`, `PLAY_RAW_ENABLED`)는 기본 꺼짐이다. 켜는 시점은 BE와 확인한다.

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
