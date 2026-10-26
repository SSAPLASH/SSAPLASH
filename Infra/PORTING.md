# 포팅 매뉴얼과 인프라 구성

서비스를 새 서버에서 다시 구축하기 위한 문서다. 구성은 `Infra/docker-compose.yml`이 기준이며, 이 문서와 다르면 코드가 맞다.

> **작성 상태 (2026-10-25 초안)**
> - 서버 최초 준비·배포·환경변수는 실제 구성 기준으로 썼다.
> - **백업·복구 절차는 서버 시험 전이다.** 시험 후 상태 표시를 "확인함"으로 바꾼다(6절).
> - HTTPS는 S15P31A307-39가 진행 중이라 현재 계획만 적었다(5절).
> - Ansible(S15P31A307-36)은 아직 없다(7절).
> - "다른 팀원이 문서만 보고 따라 해서 재현" 검증은 하지 않았다.
> - 서버 사양(인스턴스 종류, 디스크 크기)은 확인해서 2절에 채워야 한다.

## 1. 아키텍처

![인프라 구성도](./architecture.svg)

- 인터넷에서 닿는 입구는 **Nginx 하나**(80, HTTPS 후 443)다. API와 스토리지 서명 URL 요청, 모델 파일을 Nginx가 받아 전달한다.
- DB·Redis·스토리지·모니터링은 포트를 공개하지 않고 내부 네트워크(`internal`)에만 둔다.
- Grafana(3000)와 MLflow(5000)는 서버의 `127.0.0.1`에만 열려 있고 SSH 터널로 접속한다(`Infra/ACCESS.md`).
- 배포는 GitLab의 수동 `deploy` 잡이 서버 안의 배포 러너로 실행한다. 서버 접속 키가 CI에 없다.

### 기술 스택

| 영역 | 구성 | 버전 |
| --- | --- | --- |
| 서버 | AWS EC2, Ubuntu 24.04 | 인스턴스 종류·디스크 크기는 확인해 기록 |
| 컨테이너 | Docker, Docker Compose | 서버에서 `docker --version`으로 확인해 기록 |
| 웹 서버 | Nginx | 1.27-alpine |
| 앱 | Spring Boot (JDK 21) | `BE/Dockerfile`로 서버에서 직접 빌드 |
| DB | PostgreSQL + TimescaleDB | timescale/timescaledb 2.30.2-pg16 |
| 캐시 | Redis | 7-alpine |
| 오브젝트 스토리지 | SeaweedFS (S3 호환) | 4.48 |
| 모델 관리 | MLflow | `Infra/mlflow/Dockerfile` 참고 |
| 모니터링·로그 | Prometheus, node-exporter, cAdvisor, Loki, Alloy, Grafana | 각각 `docker-compose.yml`에 고정 |
| 인증서 | certbot (Let's Encrypt) | v5.8.0 (39번 진행 중) |
| CI/CD | GitLab Runner 2개(`ec2-docker`, `ec2-deploy`) | |

아직 이 구성에 들어 있지 않은 것: FE 정적 파일 서빙, AI 서비스(FastAPI) 컨테이너, EMB. 추가되면 이 절과 구성도를 고친다.

## 2. 서버 구성

### 컨테이너 (프로젝트 이름 `infra`)

| 서비스 | 역할 | 호스트 공개 | 메모리 한도 |
| --- | --- | --- | --- |
| nginx | 유일한 외부 입구, 리버스 프록시 | 80 (모든 곳) | 64m |
| api | Spring 앱 | 없음 | 768m |
| postgres | 앱 DB (+ MLflow DB) | 없음 | 1g |
| redis | 캐시·세션 | 없음 | 128m |
| seaweedfs | S3 호환 스토리지 | 없음 | 1g |
| seaweedfs-init | 버킷·만료 정책 생성(일회성) | 없음 | 256m |
| mlflow-db-init | MLflow용 DB 생성(일회성) | 없음 | 128m |
| mlflow | 실험 기록, 모델 레지스트리 | 127.0.0.1:5000 | 1g |
| prometheus | 지표 저장(15일 또는 5GB) | 없음 | 512m |
| node-exporter, cadvisor | 서버·컨테이너 지표 | 없음 | 64m, 256m |
| loki | 로그 저장(7일) | 없음 | 512m |
| alloy | 컨테이너 로그 수집, 민감정보 가림 | 없음 | 256m |
| grafana | 지표·로그 화면 | 127.0.0.1:3000 | 384m |
| certbot | 인증서 발급·갱신 도구(`--profile tools`로만 실행) | 없음 | — |

- 네트워크: `public`(외부 접속 가능), `internal`(외부 접속 없음). DB·Redis·스토리지는 `internal`에만 둔다.
- 모든 서비스가 `restart: unless-stopped`라 서버를 재부팅해도 자동으로 올라온다(재부팅 시험 확인함).
- 컨테이너 로그는 서비스마다 10MB×3개로 제한한다.

### 볼륨 (Compose가 `infra_` 접두사를 붙인다)

| 볼륨 | 내용 | 잃으면 |
| --- | --- | --- |
| `infra_pgdata` | PostgreSQL 데이터 | **서비스 데이터 전체 손실** |
| `infra_redisdata` | Redis 데이터 | 캐시·세션 손실(재생성 가능) |
| `infra_seaweeddata` | 업로드된 악보·음원 등 | **파일 손실** |
| `infra_models` | 게시된 모델 파일·매니페스트 | MLflow에서 다시 게시하면 복구 |
| `infra_letsencrypt` | 인증서와 개인 키 (39번) | 재발급(횟수 제한 주의) |
| `infra_certbot-www` | 인증서 발급 임시 파일 | 영향 없음 |
| `infra_prometheus-data`, `infra_loki-data`, `infra_grafana-data`, `infra_alloy-data` | 관측 데이터 | 과거 지표·로그 손실(앱 기능 영향 없음) |

### 서버 최초 준비 (한 번만)

서버 접속은 `Infra/ACCESS.md`를 따른다. 아래는 비어 있는 새 Ubuntu 서버 기준이다.

1. **패키지와 Docker 설치.** Docker 공식 문서의 Ubuntu 설치 절차(apt 저장소 추가, `docker-ce`, `docker-compose-plugin`)를 따른다. 설치 후 `sudo systemctl enable --now docker`로 부팅 시 자동 시작을 켠다. 복사 도구도 설치한다.
   ```
   sudo apt-get install -y rsync
   ```
2. **방화벽(ufw).** SSH를 먼저 허용한 뒤에 켠다. 순서가 바뀌면 서버에 접속할 수 없다.
   ```
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
   - 클라우드의 보안 그룹에서도 22, 80, 443을 허용해야 한다(AWS 콘솔 권한 필요).
   - Docker가 `ports:`로 공개한 포트는 ufw를 거치지 않는다. 그래서 DB·Redis는 `ports:`를 쓰지 않는다(`Infra/SECURITY.md` 2절).
3. **SSH 설정.** 비밀번호 로그인을 끈다(`PasswordAuthentication no`). 바꾸기 전에 SSH 창을 하나 더 열어 둔다(`Infra/ACCESS.md` 5절).
4. **배포 폴더와 서버 설정 파일.** 배포 절차(3절)의 "서버 최초 준비"를 따른다.
5. **CI 러너 2개.** `ec2-docker`(CI용)는 `Infra/README.md`의 CI 러너 절, `ec2-deploy`(배포용)는 `Infra/deploy/README.md`의 서버 최초 준비를 따른다. 러너 토큰은 서버 터미널에만 입력한다.
6. **자동 보안 업데이트.** Ubuntu 기본 설정(`unattended-upgrades`)이 켜져 있는지 확인한다. 커널·libc 패치는 재부팅해야 적용되므로 주 1회 `ls /var/run/reboot-required`로 확인한다.

## 3. 환경변수와 시크릿

서버의 `/srv/airdrum/Infra/.env` 한 파일에서 관리한다. 저장소에는 값 없이 이름과 설명만 있는 `Infra/.env.example`이 있다. **이 문서와 저장소에 값은 적지 않는다.**

| 변수 | 용도 | 만드는 법·주의 |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_DB` | DB 계정·DB 이름 | 예시 값 사용 가능. 바꾸면 기존 볼륨과 맞지 않는다 |
| `POSTGRES_PASSWORD` | DB 비밀번호 | **DB를 처음 만들 때 고정된다.** 나중에 바꾸려면 DB 안에서 바꾼다 |
| `REDIS_PASSWORD` | Redis 비밀번호 | `openssl rand -hex 24` |
| `JWT_SECRET` | 로그인 토큰 서명 키 | `openssl rand -base64 48`. **배포마다 바꾸지 않는다**(바꾸면 모든 로그인 토큰이 무효) |
| `FRONTEND_BASE_URL`, `OAUTH_REDIRECT_BASE_URL` | 서비스 주소, 소셜 로그인 콜백 기준 주소 | HTTPS 적용 후 `https://`로 바꾼다. 제공자 콘솔에도 같은 콜백 주소를 등록한다 |
| `GOOGLE_CLIENT_ID/SECRET`, `SSAFY_CLIENT_ID/SECRET` | 소셜 로그인 | 각 제공자 콘솔에서 발급 |
| `ADMIN_EMAILS` | 관리자 이메일(쉼표 구분) | |
| `OBJECT_STORAGE_READ_ACCESS_KEY`, `..._READ_SECRET_KEY` | 스토리지 읽기용 키 | 서버에서 직접 생성: 접근 키 `openssl rand -hex 10`, 비밀 키 `openssl rand -hex 24` |
| `OBJECT_STORAGE_WRITE_ACCESS_KEY`, `..._WRITE_SECRET_KEY` | 스토리지 쓰기용 키 | 위와 같다. 읽기용과 다른 값 |
| `OBJECT_STORAGE_PUBLIC_URL` | 브라우저가 서명 URL로 접속하는 공개 주소 | 도메인 루트, 경로 접두사 없음. HTTPS 후 `https://` |
| `CHART_ASSET_ENABLED`, `PLAY_RAW_ENABLED` | 앱의 스토리지 사용 스위치 | 서버 확인과 BE 확인 후 `true` |
| `GRAFANA_ADMIN_PASSWORD` | Grafana 관리자 비밀번호 | `openssl rand -hex 16`, 비어 있으면 Compose가 실행을 멈춘다 |

규칙(자세한 내용은 `Infra/ACCESS.md` 4절):
- 비밀값은 서버에서 직접 만들어 `.env`에 쓴다. 화면·채팅에 출력하지 않고, 확인은 변수 **이름**이나 **개수**로 한다.
- 필수 변수가 비어 있으면 Compose가 실행을 멈춘다(의도된 동작). `docker compose down`도 멈추므로 변수를 먼저 채운다.
- `.env` 권한은 600이다. 서버 배포는 `.env`를 덮어쓰거나 지우지 않는다.
- `.env` 사본은 백업(6절)과 **다른 곳**에 보관한다. 둘이 같은 곳에 있으면 한 번에 노출된다.

## 4. 배포와 롤백

`Infra/deploy/README.md`가 상세 절차다. 요약:

1. 코드는 `feat/*` → `develop-*` → (금요일 `[DEPLOY]` MR) → `main` 순으로 간다.
2. `main` 파이프라인에서 CI가 통과하면 `deploy` 잡을 **사람이 직접 실행**한다.
3. 러너가 `Infra/deploy/deploy.sh`로 `/srv/airdrum`에 복사하고 `docker compose -p infra up -d --build`, Nginx 설정 reload, 헬스체크(최대 300초)를 한다. 성공하면 `.deployed`에 커밋을 기록한다.
4. 문제가 있으면 `rollback` 잡으로 이전 커밋을 다시 배포한다. **DB 마이그레이션은 되돌리지 않는다.**
5. 이미지 레지스트리가 없어 서버에서 직접 빌드한다(3~5분).

수동(비상) 배포: 서버에서 `Infra/deploy/deploy.sh <커밋> <소스 폴더>`를 러너 사용자로 실행한다. `DRY_RUN=1`을 붙이면 순서만 확인한다.

서비스가 정상인지 확인하는 방법:
```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/health   # 서버 안에서, 200이면 Nginx 정상
docker compose -p infra ps                                          # 컨테이너 상태(healthy 확인)
```

## 5. 도메인과 HTTPS (S15P31A307-39 진행 중)

- 도메인 `k15a307.p.ssafy.io`가 서버 공개 IP를 가리킨다(확인함). 80, 443이 바깥에서 닿는 것도 확인했다.
- 코드 준비는 끝났다: Nginx의 인증서 발급 경로(`/.well-known/acme-challenge/`), `certbot` 서비스, 인증서·챌린지 볼륨.
- **남은 작업:** 서버 배포 → 스테이징 인증서 시험 발급 → 실제 발급 → 443·80→443 리다이렉트 설정 → 자동 갱신과 갱신 시험 → 앱 주소를 https로 변경 → 외부 검증.
- 이 절은 39번이 끝나면 실제 명령과 결과로 채운다.

## 6. 백업과 복구 (최소 절차, **서버 시험 전**)

> 아래 명령은 서버에서 아직 실행해 보지 않았다. 시험하면서 명령과 결과를 고치고, 이 절의 상태를 "확인함"으로 바꾼다.

### 무엇을 백업하나

| 대상 | 백업 | 이유 |
| --- | --- | --- |
| PostgreSQL (앱 DB, MLflow DB) | **필수** | 서비스 데이터 |
| SeaweedFS 볼륨 | **필수** | 업로드된 악보·음원·MLflow 아티팩트 |
| `.env` | **필수**(다른 곳에 따로) | 없으면 서비스를 다시 올릴 수 없다 |
| `infra_letsencrypt` | 권장 | 재발급은 가능하지만 횟수 제한이 있다. 개인 키가 들어 있다 |
| `infra_models` | 선택 | MLflow에서 다시 게시할 수 있다 |
| Prometheus·Loki·Grafana 볼륨 | 안 함 | 관측 데이터는 재생성 가능. 대시보드·알림은 코드(`Infra/monitoring/`)에 있다 |
| Redis | 안 함 | 캐시 |

### 원칙
- **백업을 서버 안에만 두지 않는다.** 서버가 사라지면 같이 사라진다. 서버 밖(담당자 PC나 별도 저장소)에 복사한다.
- 백업 파일에는 개인정보·개인 키가 들어 있다. 저장소에 올리지 않고 접근을 제한한다(`chmod 600`).
- 백업은 **복원해 봐야** 백업이다. 새 서버나 시험 환경에서 복원을 시험한다.
- 보관: 최근 7개 정도를 남기고 지운다(디스크가 가득 차지 않게).

### PostgreSQL

백업(서버에서, 컨테이너가 실행 중일 때):
```
mkdir -p ~/backup && cd ~/backup
docker compose -p infra -f /srv/airdrum/Infra/docker-compose.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > app_$(date +%F).dump
docker compose -p infra -f /srv/airdrum/Infra/docker-compose.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc mlflow' > mlflow_$(date +%F).dump
chmod 600 *.dump
```
- `-Fc`는 복원 도구(`pg_restore`)가 쓰는 압축 형식이다. 컨테이너 안의 환경변수(`POSTGRES_USER`)를 쓰므로 비밀번호를 명령에 쓰지 않는다.

복원(비어 있는 DB에 한다):
```
# 앱 DB. TimescaleDB는 복원 전후에 확장 전용 함수를 호출해야 한다.
docker compose -p infra -f /srv/airdrum/Infra/docker-compose.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT timescaledb_pre_restore();"'
docker compose -p infra -f /srv/airdrum/Infra/docker-compose.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < app_<날짜>.dump
docker compose -p infra -f /srv/airdrum/Infra/docker-compose.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT timescaledb_post_restore();"'
```
- TimescaleDB 복원 절차(`pre_restore`/`post_restore`)는 공식 문서 기준이며 이 서버에서 시험해야 한다. 앱이 Flyway 등으로 스키마를 만든다면, 복원 대상 DB는 스키마가 없는 빈 DB여야 하는지 BE와 확인한다.
- `docker-compose.yml`의 주석도 "운영 전환 전 백업·복원 검증이 필요하다"고 적고 있다.

### SeaweedFS 볼륨

일관성을 위해 쓰기를 멈추고 복사한다(앱이 잠깐 스토리지에 접근하지 못한다).
```
docker compose -p infra -f /srv/airdrum/Infra/docker-compose.yml stop seaweedfs
docker run --rm -v infra_seaweeddata:/data:ro -v ~/backup:/backup alpine \
  tar czf /backup/seaweed_$(date +%F).tgz -C /data .
docker compose -p infra -f /srv/airdrum/Infra/docker-compose.yml start seaweedfs
chmod 600 ~/backup/seaweed_*.tgz
```
- 볼륨 이름(`infra_seaweeddata`)은 `docker volume ls`로 확인한다.
- 복원은 새 서버에서 볼륨을 만들고 같은 방식으로 `tar xzf`로 푼 뒤 `seaweedfs`를 시작한다.

### 인증서 볼륨 (39번 이후)
```
docker run --rm -v infra_letsencrypt:/data:ro -v ~/backup:/backup alpine \
  tar czf /backup/letsencrypt_$(date +%F).tgz -C /data .
chmod 600 ~/backup/letsencrypt_*.tgz
```
- 개인 키가 들어 있다. 반드시 서버 밖의 안전한 곳에 보관하고 저장소·채팅에 올리지 않는다.

### 새 서버에 전체 복구하는 순서
1. 2절 "서버 최초 준비"를 한다(Docker, ufw, 러너).
2. 보관해 둔 `.env`를 `/srv/airdrum/Infra/.env`에 놓는다(권한 600). **DB 비밀번호가 바뀌면 복원한 DB에 접속하지 못한다.**
3. `main`을 배포한다(4절). 앱이 빈 DB로 한 번 시작할 수 있다.
4. 앱을 멈추고(`stop api`) DB를 복원한 뒤 앱을 시작한다.
5. SeaweedFS 볼륨을 복원하고 `seaweedfs`를 시작한다.
6. (39번 이후) 인증서 볼륨을 복원하거나 새로 발급한다.
7. `/health`, 로그인, 악보 불러오기를 확인한다.

### 주의
- 서버에서 `docker volume prune`, `docker system prune --volumes`를 실행하지 않는다. 멈춘 서비스의 볼륨이 삭제된다.
- 볼륨을 지우는 명령(`docker compose down -v`)은 시험 환경에서만 쓴다.
- 자동화(cron 등)는 시험이 끝난 뒤에 한다. 지금은 수동 절차다.

## 7. Ansible (S15P31A307-36, 미작성)

아직 플레이북이 없다. 2절의 "서버 최초 준비"와 3~4절이 플레이북이 될 작업 목록이다.

| 작업 | 위치 |
| --- | --- |
| Docker 설치, `rsync` 설치 | 2절 1번 |
| ufw 규칙, SSH 설정(`PasswordAuthentication no` 등) | 2절 2~3번 |
| `/srv/airdrum` 생성, 러너 사용자 소유 | 배포 README |
| `gitlab-runner` 설치·등록(토큰은 변수로 받고 저장소에 두지 않는다) | `Infra/README.md`, `Infra/deploy/README.md` |
| `gitlab-runner`를 docker 그룹에 추가 | 배포 README |
| `unattended-upgrades` 설정 | 2절 6번 |

플레이북이 생기면 실행 방법(인벤토리, 변수, 명령)을 이 절에 적는다. 비밀값은 Ansible Vault나 서버 입력으로 다루고 저장소에 평문으로 두지 않는다.

## 8. 운영 점검

| 주기 | 점검 |
| --- | --- |
| 배포 후 | `/health` 200, `docker compose -p infra ps`의 healthy |
| 주 1회 | `ls /var/run/reboot-required`(있으면 CI·배포가 없을 때 재부팅), 디스크 사용량(`df -h`) |
| 필요할 때 | 접속 기록(`last`, `journalctl -u ssh`), 열린 포트(`sudo ss -tlnp`) |

관련 문서: [서버 접속 가이드](./ACCESS.md), [보안 점검 기록](./SECURITY.md), [트러블슈팅](./TROUBLESHOOTING.md), [배포](./deploy/README.md)
