# 배포(CD)

`main`에 병합된 코드를 EC2에 배포하는 절차다. 서버 전체 구성과 포팅 매뉴얼은 S15P31A307-46에서 이어 쓴다.

## 구성

```
main 병합 → 파이프라인 → deploy 잡(수동 승인) → ec2-deploy 러너(서버 호스트) → deploy.sh → docker compose
```

- 배포는 **main 기준**이다. `main`에는 금요일 정기 릴리즈(`[DEPLOY] develop-* → main`)와 핫픽스로만 들어간다.
- 이미지 레지스트리가 없어 **서버에서 직접 빌드**한다(`docker compose up --build`).
- 배포 전용 러너 `ec2-deploy`는 서버 호스트에서 직접 돈다(shell executor). 러너와 서버가 같은 머신이라 **서버 접속 키(SSH)가 필요 없다.**
- 서버의 `.env`(비밀번호, 키)는 서버에만 있고 저장소와 CI 변수에 올리지 않는다.
- 코드는 서버의 고정 폴더 `/srv/airdrum`에 복사해 실행한다. 잡 체크아웃은 매번 지워지기 때문이다.
- Compose 프로젝트 이름은 `infra`로 고정한다. 폴더가 바뀌어도 데이터 볼륨(`infra_pgdata`, `infra_redisdata`, `infra_seaweeddata`)이 유지된다.

| 항목 | 값 |
| --- | --- |
| 러너 | `ec2-deploy` (shell executor, 보호된 러너, 태그 `deploy`, 태그 없는 job은 받지 않음) |
| 배포 폴더 | `/srv/airdrum` (`Infra/`, `BE/`, 이후 `AI/`) |
| 서버 설정 파일 | `/srv/airdrum/Infra/.env` (저장소에 없음) |
| 배포 기록 | `/srv/airdrum/.deployed` (한 줄에 시각과 커밋 해시. 마지막 줄이 현재 버전) |
| 동시 실행 | `resource_group: production`으로 배포와 롤백이 겹치지 않는다 |

## 서버 최초 준비 (한 번만)

서버(`ubuntu@ip-...`)에서 실행한다. 러너 토큰은 서버 터미널에만 입력하고 채팅·문서에 붙이지 않는다.

1. 복사 도구를 설치한다.

   ```
   sudo apt-get install -y rsync
   ```

2. 배포 폴더를 만들고 러너 사용자 소유로 한다.

   ```
   sudo mkdir -p /srv/airdrum/Infra
   sudo chown -R gitlab-runner:gitlab-runner /srv/airdrum
   ```

3. 기존 서버 설정 파일을 배포 폴더로 옮긴다. 시험 구동 때 만든 `.env`가 있으면 그 값을 그대로 쓴다(DB 비밀번호가 바뀌면 기존 DB에 접속하지 못한다).

   ```
   sudo cp ~/S15P31A307/Infra/.env /srv/airdrum/Infra/.env
   sudo chown gitlab-runner:gitlab-runner /srv/airdrum/Infra/.env
   sudo chmod 600 /srv/airdrum/Infra/.env
   ```

4. GitLab에서 배포 러너를 만든다. Settings → CI/CD → Runners → New project runner.
   - Tags: `deploy`
   - **Protected: 켠다** (보호된 브랜치에서 도는 job만 받는다. 배포 러너는 서버 전체 권한이 있어 반드시 필요하다)
   - Run untagged jobs: 끈다
   - Description: `ec2-deploy`

5. 서버에서 shell executor로 등록한다. `<새토큰>`은 4번 화면의 `glrt-` 값이다.

   ```
   sudo gitlab-runner register --non-interactive --url https://lab.ssafy.com --token <새토큰> --executor shell --description ec2-deploy
   ```

6. 러너 사용자가 Docker를 쓸 수 있게 하고 러너를 재시작한다.

   ```
   sudo usermod -aG docker gitlab-runner
   sudo systemctl restart gitlab-runner
   ```

7. 확인한다.
   - GitLab Runners 화면에서 `ec2-deploy`가 온라인(초록)이다.
   - `sudo -u gitlab-runner docker ps`가 오류 없이 실행된다.
   - `main` 브랜치가 보호되어 있다(Settings → Repository → Protected branches).

## 배포

1. `main`에 병합되면 파이프라인이 만들어진다. CI 잡(`be-test` 등)이 통과했는지 확인한다.
2. 파이프라인의 `deploy` 잡을 **직접 실행**(재생 버튼)한다. 실행 권한은 `main`을 병합할 수 있는 Maintainer에게 있다.
3. `deploy`는 `Infra/deploy/deploy.sh`를 실행한다.
   - 소스를 `/srv/airdrum`으로 복사한다(`.env`는 건드리지 않는다).
   - `docker compose -p infra up -d --build`로 갱신하고 Nginx 설정을 다시 읽게 한다.
   - 앱이 `healthy`이고 `http://localhost/health`가 `ok`일 때까지 최대 300초 기다린다.
   - 성공하면 `.deployed`에 커밋 해시를 기록한다.
4. 앱 이미지를 새로 빌드하므로 3~5분 걸린다. 빌드가 실패하면 기존 컨테이너는 그대로 유지된다.

## 롤백

1. 파이프라인의 `rollback` 잡을 **변수와 함께 실행**한다.
   - `ROLLBACK_SHA`에 되돌릴 커밋 해시를 넣는다. 비워 두면 `.deployed`의 직전 성공 버전이다.
2. 롤백은 그 커밋의 소스로 같은 절차를 다시 실행한다. 새로 빌드하므로 3~5분 걸린다.
3. **DB 마이그레이션은 되돌리지 않는다.** 새 마이그레이션이 이미 적용된 DB에 옛 앱을 올리면 시작하지 못할 수 있다.
   - 롤백 전에 되돌릴 구간에 `BE/src/main/resources/db/migration/`의 새 파일이 있는지 확인한다.
   - 있으면 옛 앱이 새 스키마와 호환되는지 BE에 확인한다. 호환되지 않으면 롤백하지 말고 앞으로 고친 버전을 배포한다.
   - 마이그레이션은 하위 호환으로 쓰는 것을 BE와 합의한다(컬럼 삭제·이름 변경은 두 번에 나눠서).

## 서버 설정 변경

- `.env` 값(비밀번호, 소셜 로그인 키, 스토리지 키, 스위치)은 **서버에서 직접** `/srv/airdrum/Infra/.env`를 고친다. 코드 배포로 바뀌지 않는다.
- Postgres 비밀번호는 DB를 처음 만들 때 한 번만 적용된다. 나중에 바꾸려면 볼륨을 지우거나 DB 안에서 직접 바꿔야 한다(운영 데이터가 있으면 지우지 않는다).
- `.env`를 고친 뒤에는 `deploy` 잡을 다시 실행하거나 서버에서 `docker compose -p infra up -d`로 반영한다.

## 문제 해결

| 증상 | 원인과 해결 |
| --- | --- |
| `deploy` 잡이 대기 상태로 멈춤 | `ec2-deploy` 러너가 온라인이 아니거나 `main`이 아닌 브랜치다. 러너 화면과 브랜치를 확인한다 |
| `서버 설정 파일이 없습니다` | `/srv/airdrum/Infra/.env`가 없다. 서버 최초 준비 3번을 한다 |
| `permission denied` (docker) | 러너 사용자가 docker 그룹에 없다. 서버 최초 준비 6번을 하고 러너를 재시작한다 |
| `rsync: command not found` | 서버 최초 준비 1번을 한다 |
| `헬스체크 실패` | 잡 로그 끝의 `docker compose ps`와 앱 로그를 본다. 환경변수 누락(`JWT_SECRET` 등)이나 DB 비밀번호 불일치가 흔하다 |
| 배포 후 Nginx가 옛 설정 | 배포 스크립트가 `nginx -s reload`를 실행한다. 실패했다면 설정 문법 오류이므로 `docker compose -p infra exec nginx nginx -t`로 확인한다 |

## 처음 전환할 때 알아 둘 것

- 시험 구동 때는 `~/S15P31A307/Infra`에서 `develop-BE` 계열 브랜치로 직접 띄웠다. 같은 프로젝트 이름(`infra`)을 쓰므로 첫 배포에서 컨테이너가 새 폴더 기준으로 다시 만들어지지만 데이터 볼륨은 유지된다.
- `main`에 `Infra/`가 들어가는 첫 `[DEPLOY]` 전에는 정식 배포를 할 수 없다. 그 전까지의 시험은 서버에서 `Infra/deploy/deploy.sh <커밋> <소스 폴더>`를 수동으로 실행해 한다. `DRY_RUN=1`을 붙이면 실제 실행 없이 순서만 확인할 수 있다.
