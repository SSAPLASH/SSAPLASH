#!/usr/bin/env bash
# 운영 워커(사이트 BE)와 테스트용 BE 워커를 같은 곡으로 py-spy 기록해 어느 코드에서 시간이 다른지 비교.
# ptrace_scope=1이라 떠 있는 워커에는 붙을 수 없으므로, py-spy가 워커를 자식 프로세스로 직접 띄움.
# 사용법: JupyterHub 터미널에서 bash ~/ssaplash/notebooks/profile_worker.sh
# 순서: 운영 워커 멈춤 → py-spy 아래에서 운영 워커 시작 → 사이트 업로드 한 곡 기록 → 테스트용 BE로 같은 곡 기록
#       → 운영 워커를 CPU 0~127번에 묶어 다시 시작 → 결과 zip
# 운영 워커는 taskset -c 0-127로 띄움 (docs/트러블슈팅-워커-처리-속도.md)
set -u
AI=~/ssaplash/S15P31A307/AI
RES=~/ssaplash/results/profile-$(date +%m%d_%H%M)
LOG=~/ssaplash/results/worker.log
SONG=~/ssaplash/upload/speed_songs/uptown.mp3
SCRIPT=~/ssaplash/notebooks/worker_speed_check.py
PAT='\.venv/bin/ssaplash-worker run'
SPY_OPTS=(record --subprocesses --idle --threads --nonblocking --rate 50 --format raw)

stop_workers() {
    # TERM은 프로세스마다 한 번만. 두 번 보내면 처리 중인 곡을 버리고 바로 꺼짐
    for p in $(pgrep -f "$PAT"); do kill -TERM "$p" 2>/dev/null; done
    while pgrep -f "$PAT" >/dev/null; do sleep 2; done
}

mkdir -p "$RES"
cd "$AI" || exit 1
[ -f "$SONG" ] || { echo "곡 파일 없음: $SONG"; exit 1; }
[ -f "$SCRIPT" ] || { echo "측정 스크립트 없음: $SCRIPT"; exit 1; }

echo "[1/6] py-spy 준비"
uv tool install --quiet py-spy >/dev/null 2>&1
PYSPY="$(uv tool dir --bin)/py-spy"
[ -x "$PYSPY" ] || { echo "py-spy 설치 실패"; exit 1; }
"$PYSPY" --version

echo "[2/6] 운영 워커 멈춤. 처리 중인 곡이 있으면 그 곡을 끝낸 뒤 멈춤"
stop_workers
set -a; source ~/ssaplash/worker.env; set +a

echo "[3/6] py-spy 아래에서 운영 워커 시작. 모델이 다 올라오면 업로드하라는 줄이 나옴"
E=$(grep -c "끝:" "$LOG")
M=$(grep -c "채보 모델 올림" "$LOG")
(
    while [ "$(grep -c "채보 모델 올림" "$LOG")" -eq "$M" ]; do sleep 1; done
    echo "[4/6] 지금 사이트에 uptown.mp3를 올리면 됨. 작업이 끝나면 자동으로 다음 단계로 감"
    while [ "$(grep -c "끝:" "$LOG")" -eq "$E" ]; do sleep 2; done
    grep "끝:" "$LOG" | tail -1 | tee "$RES/prod_job.txt"
    sleep 1
    pkill -INT -f "py-spy record .*prod_profile" # SIGINT를 받으면 py-spy가 기록을 파일로 씀
) &
WATCH=$!
taskset -c 0-127 "$PYSPY" "${SPY_OPTS[@]}" -o "$RES/prod_profile.txt" -- "$AI/.venv/bin/ssaplash-worker" run \
    >> "$LOG" 2>&1 < /dev/null
kill "$WATCH" 2>/dev/null # py-spy가 다른 이유로 먼저 끝났을 때 대기 루프 정리
stop_workers

echo "[5/6] 테스트용 BE로 같은 곡 기록 (2분 안팎). 이동안 사이트 업로드는 대기열에서 기다림"
"$PYSPY" "${SPY_OPTS[@]}" -o "$RES/fake_profile.txt" -- "$AI/.venv/bin/python" "$SCRIPT" \
    --song "$SONG" --gpu-index 6 --skip-variant --threads 16 --out "$RES/fake" \
    > "$RES/fake_run.log" 2>&1 < /dev/null
grep -A4 "설정별 중앙값" "$RES/fake/summary.md" | tail -1 | tee "$RES/fake_job.txt"

echo "[6/6] 운영 워커를 원래 방식으로 다시 시작하고 결과를 묶음"
setsid nohup taskset -c 0-127 uv run --no-sync ssaplash-worker run >> "$LOG" 2>&1 < /dev/null &
sleep 5
pgrep -f "$PAT" | head -1 | tee ~/ssaplash/worker.pid
tail -300 "$LOG" > "$RES/worker_tail.log"
"$AI/.venv/bin/python" -c "import shutil, sys; print(shutil.make_archive(sys.argv[1], 'zip', sys.argv[1]))" "$RES"
echo "끝. 위 zip 파일을 내려받으면 됨"
