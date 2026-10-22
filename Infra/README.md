# Infra

배포 구성과 CI 러너 운영 안내. 서버 전체 구성과 포팅 매뉴얼은 S15P31A307-46에서 이 문서에 이어 쓴다.

## CI 러너

CI는 EC2의 GitLab Runner에서 실행한다. 개인 PC에 러너를 두지 않는다.

| 항목 | 값 |
| --- | --- |
| 러너 이름 | `ec2-docker` |
| 실행 방식 | Docker executor (Linux) |
| 태그 | `docker` (모든 job이 `.gitlab-ci.yml`의 `default:`에서 이 태그를 쓴다) |
| 태그 없는 job | 받지 않는다 |
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
2. 같은 화면에서 새 러너를 만든다. 태그는 `docker`, 태그 없는 job 실행은 끈다.
3. EC2에서 `sudo gitlab-runner verify --delete`로 서버에 남은 옛 설정을 지운다.
4. EC2에서 새 토큰으로 `sudo gitlab-runner register`를 실행한다. 토큰은 서버 터미널에만 입력한다.
5. `sudo systemctl status gitlab-runner`로 동작을 확인하고 GitLab에서 온라인 표시를 확인한다.
