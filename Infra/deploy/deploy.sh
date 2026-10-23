#!/usr/bin/env bash
# 서버에서 Compose 스택을 갱신하는 배포 스크립트다. 배포 러너(ec2-deploy)가 main의 job 안에서 실행한다.
# 롤백도 같은 스크립트로 한다. 이전 커밋의 소스를 소스 폴더로 넘기면 그 버전이 다시 배포된다.
#
# 사용: deploy.sh <커밋 해시> [소스 폴더]
#   소스 폴더: Infra/, BE/(AI/)가 들어 있는 저장소 체크아웃이다. 기본은 현재 폴더다.
# 환경변수:
#   DEPLOY_DIR      배포 폴더. 기본 /srv/airdrum
#   HEALTH_TIMEOUT  헬스체크 대기 시간(초). 기본 300
#   DRY_RUN=1       복사·Compose 실행 없이 순서만 출력한다
set -euo pipefail

SHA="${1:?사용법: deploy.sh <커밋 해시> [소스 폴더]}"
SRC="${2:-$PWD}"
DIR="${DEPLOY_DIR:-/srv/airdrum}"
TIMEOUT="${HEALTH_TIMEOUT:-300}"
# 프로젝트 이름을 고정한다. 폴더가 바뀌어도 기존 데이터 볼륨(infra_pgdata 등)을 그대로 쓴다.
PROJECT=infra
DRY_RUN="${DRY_RUN:-0}"

log() { echo "[deploy] $*"; }

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

[ -f "$SRC/Infra/docker-compose.yml" ] || { log "소스 폴더에 Infra/docker-compose.yml이 없습니다: $SRC"; exit 1; }

# .env(비밀번호, 키)는 서버에만 있고 저장소에도 CI 변수에도 없다. 없으면 시작하지 않는다.
if [ ! -f "$DIR/Infra/.env" ]; then
  log "서버 설정 파일이 없습니다: $DIR/Infra/.env (README의 서버 최초 준비를 먼저 하세요)"
  [ "$DRY_RUN" = "1" ] || exit 1
fi

# 직전에 성공한 커밋. 실패했을 때 롤백 대상을 알려 주려고 먼저 읽어 둔다.
PREV=""
if [ -f "$DIR/.deployed" ]; then
  PREV="$(tail -n 1 "$DIR/.deployed" | awk '{print $2}')"
fi
log "배포 시작: $SHA (직전 성공: ${PREV:-없음})"

# 1. 소스를 고정 폴더로 복사한다. .env는 덮어쓰거나 지우지 않는다.
#    --inplace: nginx 설정처럼 파일 하나를 컨테이너에 직접 연결한 경우 파일 교체로 연결이 끊기지 않게 한다.
for d in Infra BE AI; do
  [ -d "$SRC/$d" ] || continue
  run mkdir -p "$DIR/$d"
  run rsync -a --delete --inplace --exclude '.env' --exclude 'build/' --exclude '.gradle/' "$SRC/$d/" "$DIR/$d/"
done

# 2. Compose를 갱신한다. 이미지는 서버에서 직접 빌드한다(레지스트리 없음).
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] cd $DIR/Infra"
else
  cd "$DIR/Infra"
fi
run docker compose -p "$PROJECT" up -d --build
# 3. 바뀐 nginx 설정을 읽게 한다. 설정에 오류가 있으면 여기서 실패한다.
run docker compose -p "$PROJECT" exec -T nginx nginx -s reload

# 4. 헬스체크: 앱 컨테이너가 healthy이고 nginx의 /health가 ok일 때까지 기다린다.
wait_healthy() {
  local deadline=$((SECONDS + TIMEOUT))
  while (( SECONDS < deadline )); do
    local api status=""
    api="$(docker compose -p "$PROJECT" ps -q api || true)"
    if [ -n "$api" ]; then
      status="$(docker inspect -f '{{.State.Health.Status}}' "$api" 2>/dev/null || true)"
    fi
    if [ "$status" = "healthy" ] && [ "$(curl -fsS --max-time 5 http://localhost/health 2>/dev/null || true)" = "ok" ]; then
      return 0
    fi
    sleep 5
  done
  return 1
}

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] 헬스체크: api가 healthy이고 http://localhost/health가 ok일 때까지 최대 ${TIMEOUT}초"
  echo "[dry-run] 성공하면 $DIR/.deployed에 $SHA 기록"
  exit 0
fi

if ! wait_healthy; then
  log "헬스체크 실패: ${TIMEOUT}초 안에 정상이 되지 않았습니다."
  docker compose -p "$PROJECT" ps || true
  docker compose -p "$PROJECT" logs --tail 40 api || true
  log "직전 성공 커밋: ${PREV:-없음}. 롤백 잡으로 되돌릴 수 있습니다."
  exit 1
fi

echo "$(date -Is) $SHA" >> "$DIR/.deployed"
log "배포 완료: $SHA"
