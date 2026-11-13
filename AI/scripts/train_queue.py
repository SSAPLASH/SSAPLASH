"""GPU 서버에서 파인튜닝 학습을 하나씩 차례로 돌리는 대기열 (S15P31A307-164 설계 v0.4 3-4·4-3절).

학습 셋을 동시에 띄우면 데이터 읽기 작업이 많아 Jupyter가 버벅여서(10/30), 대기열 하나가 학습을
`nice`로 돌림. 기본은 하나씩이고, `--parallel N`이면 N개까지 같이 돌리며 `--cpus`로 정한 코어에만 묶어
Jupyter 몫을 남김(실제 녹음 확인 실험).
실행 폴더 하나에 코드 사본과 상태 파일을 모아 둠.

  <run-dir>/S15P31A307/AI   코드 사본. 학습은 PYTHONPATH로 이 사본의 src를 읽음. data는 공유 폴더 링크
  <run-dir>/status/         queue.json(학습 목록)·queue.pid·queue.log, 학습별 <이름>.log·.pid·.DONE·.FAILED

  python scripts/train_queue.py start --run-dir ~/ssaplash/runs/164-train --zip ~/ssaplash/upload/S15P31A307_code.zip \
      --shared-ai ~/ssaplash/S15P31A307/AI --run tom_5cls=configs/train/adtof_tom_5cls.yaml …
  python scripts/train_queue.py status --run-dir ~/ssaplash/runs/164-train
  python scripts/train_queue.py stop --run-dir ~/ssaplash/runs/164-train

- start는 대기열이 살아 있으면 새로 띄우지 않음. 코드 사본이 이미 있으면 다시 풀지 않음(새 코드는 새 실행 폴더로)
- 학습은 `adtof-finetune --resume`로 부르므로 끊긴 학습은 last.pth에서 이어 감. DONE인 학습은 건너뜀
- 도는지는 pid가 살아 있는지로, 끝났는지는 DONE·FAILED 파일로 판단(로그 파일이 있는지로 판단하지 않음)
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import zipfile
from collections.abc import Callable, Sequence
from pathlib import Path

CODE_SUBDIR = Path("S15P31A307/AI")
ZIP_DATA_PREFIX = "S15P31A307/AI/data/"
DONE_MARK = "[train] 끝."
# 데이터 읽기 작업 하나가 코어 1개만 쓰게 함 (안 하면 numpy가 작업마다 서버 코어를 다 쓰려 함)
THREAD_ENV = {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"}


def status_dir(run_dir: Path) -> Path:
    return run_dir / "status"


def pid_alive(pid: int) -> bool:
    """리눅스 /proc 기준으로 살아 있는지. 좀비(Z)는 죽은 것으로 봄. /proc이 없으면 False."""
    stat = Path(f"/proc/{pid}/stat")
    try:
        text = stat.read_text()
    except OSError:
        return False
    return text.rsplit(")", 1)[-1].split()[0] != "Z"


def read_pid(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


def extract_code(zip_path: Path, run_dir: Path) -> int:
    """코드 zip을 실행 폴더에 풂. AI/data 아래 파일은 빼고(공유 data 링크 자리) 푼 파일 수를 돌려줌."""
    with zipfile.ZipFile(zip_path) as zf:
        members = [m for m in zf.namelist() if not m.startswith(ZIP_DATA_PREFIX)]
        zf.extractall(run_dir, members)
    return len(members)


def run_state(st: Path, name: str) -> str:
    """학습 하나의 상태 문자열."""
    if (st / f"{name}.DONE").is_file():
        return "끝남"
    if (st / f"{name}.FAILED").is_file():
        return f"실패 ({(st / f'{name}.FAILED').read_text(encoding='utf-8').strip()})"
    pid = read_pid(st / f"{name}.pid")
    if pid is not None and pid_alive(pid):
        return f"도는 중 pid {pid}"
    if pid is not None:
        return "멈춤 (끝 표시 없이 꺼짐. start로 다시 띄우면 이어 감)"
    return "대기"


def cmd_start(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).expanduser()
    st = status_dir(run_dir)
    st.mkdir(parents=True, exist_ok=True)
    pid = read_pid(st / "queue.pid")
    if pid is not None and pid_alive(pid):
        print(f"대기열이 이미 돌고 있음 pid {pid}. 새로 띄우지 않음. status로 확인")
        return 1

    code = run_dir / CODE_SUBDIR
    if code.is_dir():
        print(f"코드 사본 그대로 씀: {code}")
    else:
        n = extract_code(Path(args.zip).expanduser(), run_dir)
        print(f"코드 사본 풂: {code} (파일 {n}개)")
    data = code / "data"
    if not data.exists():
        data.symlink_to(Path(args.shared_ai).expanduser().resolve() / "data")
    print(f"data 링크: {data} → {os.path.realpath(data)}")

    runs = []
    for item in args.run:
        name, _, config = item.partition("=")
        if not config or not (code / config).is_file():
            print(f"학습 설정을 못 찾음: {item}")
            return 1
        runs.append({"name": name, "config": config})
    queue = {
        "runs": runs,
        "out_root": args.out_root,
        "num_workers": args.num_workers,
        "python": args.python,
        "parallel": args.parallel,
        "cpus": args.cpus,
    }
    (st / "queue.json").write_text(
        json.dumps(queue, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    env = dict(os.environ, **THREAD_ENV, PYTHONPATH=str(code / "src"), PYTHONUNBUFFERED="1")
    script = code / "scripts" / "train_queue.py"
    cmd = ["nice", "-n", str(args.nice), args.python, str(script), "run", "--run-dir", str(run_dir)]
    with (st / "queue.log").open("a", encoding="utf-8") as log:
        proc = subprocess.Popen(
            cmd, cwd=code, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
        )
    (st / "queue.pid").write_text(str(proc.pid))
    order = " → ".join(r["name"] for r in runs)
    print(
        f"대기열 시작 pid {proc.pid}: {order}, 동시 {args.parallel}개, "
        f"데이터 읽기 작업 학습마다 {args.num_workers}개, nice {args.nice}"
        + (f", 코어 {args.cpus}" if args.cpus else "")
    )
    return 0


def train_command(queue: dict, run: dict) -> list[str]:
    cmd = [
        queue["python"], "-m", "ssaplash_ai.train.cli", "adtof-finetune",
        "--config", run["config"],
        "--out", f"{queue['out_root']}/{run['name']}",
        "--num-workers", str(queue["num_workers"]),
        "--resume",
    ]  # fmt: skip
    # 학습과 데이터 읽기 작업을 정한 코어에만 묶음(자식 프로세스도 같은 코어를 물려받음). Jupyter 몫을 남기려는 것
    if queue.get("cpus"):
        cmd = ["taskset", "-c", str(queue["cpus"]), *cmd]
    return cmd


def run_queue(
    run_dir: Path,
    make_cmd: Callable[[dict, dict], list[str]] = train_command,
    code_src: Path | None = None,
    poll_sec: float = 10.0,
) -> int:
    """queue.json의 학습을 적힌 순서로 parallel개까지 동시에 돌림. 하나가 끝나면 다음 것을 띄움.
    실패해도 다음 학습으로 넘어감. 실패 수를 돌려줌."""
    st = status_dir(run_dir)
    queue = json.loads((st / "queue.json").read_text(encoding="utf-8"))
    parallel = max(1, int(queue.get("parallel", 1)))
    src = code_src or run_dir / CODE_SUBDIR / "src"
    import ssaplash_ai

    loaded = Path(ssaplash_ai.__file__).resolve()
    if not loaded.is_relative_to(src.resolve()):
        msg = f"ssaplash_ai를 코드 사본이 아닌 {loaded}에서 읽음. PYTHONPATH 확인"
        print(f"[queue] {msg}", flush=True)
        (st / "queue.FAILED").write_text(msg, encoding="utf-8")
        return 1
    print(
        f"[queue] 시작 {time.strftime('%m-%d %H:%M')}, 코드 {loaded.parent}, 동시 {parallel}개"
        + (f", 코어 {queue['cpus']}" if queue.get("cpus") else ""),
        flush=True,
    )

    pending = []
    for run in queue["runs"]:
        if (st / f"{run['name']}.DONE").is_file():
            print(f"[queue] {run['name']} 이미 끝남, 건너뜀", flush=True)
        else:
            pending.append(run)
    # 이름 → (프로세스, 로그 파일)
    running: dict[str, tuple[subprocess.Popen, object]] = {}
    failed = 0
    while pending or running:
        while pending and len(running) < parallel:
            run = pending.pop(0)
            name = run["name"]
            (st / f"{name}.FAILED").unlink(missing_ok=True)
            print(f"[queue] {name} 시작 {time.strftime('%m-%d %H:%M')}", flush=True)
            log = (st / f"{name}.log").open("a", encoding="utf-8")
            proc = subprocess.Popen(
                make_cmd(queue, run),
                stdout=log,
                stderr=subprocess.STDOUT,
                env=dict(
                    os.environ, PYTHONIOENCODING="utf-8"
                ),  # 로그를 utf-8로 읽어 끝 표시를 찾음
            )
            (st / f"{name}.pid").write_text(str(proc.pid))
            running[name] = (proc, log)
        for name in [n for n, (p, _) in running.items() if p.poll() is not None]:
            proc, log = running.pop(name)
            log.close()
            failed += not _finish(st, name, proc.returncode)
        if running:
            time.sleep(poll_sec)
    (st / "queue.DONE").write_text(time.strftime("%m-%d %H:%M"), encoding="utf-8")
    print(f"[queue] 전부 끝. 실패 {failed}개", flush=True)
    return failed


def _finish(st: Path, name: str, rc: int) -> bool:
    """끝난 학습의 DONE·FAILED 표시. 종료 코드 0이고 로그에 끝 표시가 있어야 성공."""
    log_path = st / f"{name}.log"
    ok = rc == 0 and DONE_MARK in log_path.read_text(encoding="utf-8", errors="replace")
    if ok:
        (st / f"{name}.DONE").write_text(time.strftime("%m-%d %H:%M"), encoding="utf-8")
    else:
        (st / f"{name}.FAILED").write_text(f"종료 코드 {rc}", encoding="utf-8")
    print(f"[queue] {name} {'끝남' if ok else f'실패 (종료 코드 {rc})'}", flush=True)
    return ok


def cmd_run(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).expanduser()
    (status_dir(run_dir) / "queue.DONE").unlink(missing_ok=True)
    return 1 if run_queue(run_dir) else 0


def tail_lines(path: Path, n: int, contains: str = "") -> list[str]:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [line for line in lines if contains in line][-n:]


def server_load() -> str:
    """load 평균과 남은 메모리, 우리 계정의 데이터 읽기 작업 수. /proc이 없으면 빈 문자열."""
    try:
        load1 = Path("/proc/loadavg").read_text().split()[0]
        mem = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
    except OSError:
        return ""
    gb = lambda key: int(mem[key].split()[0]) / 1024**2  # noqa: E731
    uid, workers = os.getuid(), 0
    for p in Path("/proc").iterdir():
        if p.name.isdigit():
            try:
                if p.stat().st_uid == uid and (p / "comm").read_text().strip() == "pt_data_worker":
                    workers += 1
            except OSError:
                pass
    return (
        f"[서버] load {load1} / 코어 {os.cpu_count()}, 남은 메모리 {gb('MemAvailable'):.0f}GB"
        f" / {gb('MemTotal'):.0f}GB, 우리 데이터 읽기 작업 {workers}개"
    )


def cmd_status(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).expanduser()
    st = status_dir(run_dir)
    if not (st / "queue.json").is_file():
        print(f"대기열을 시작한 적 없음: {st}")
        return 1
    queue = json.loads((st / "queue.json").read_text(encoding="utf-8"))
    pid = read_pid(st / "queue.pid")
    if pid is not None and pid_alive(pid):
        print(f"[대기열] 도는 중 pid {pid}")
    elif (st / "queue.FAILED").is_file():
        print(f"[대기열] 실패: {(st / 'queue.FAILED').read_text(encoding='utf-8')}")
    elif (st / "queue.DONE").is_file():
        print(f"[대기열] 전부 끝남 ({(st / 'queue.DONE').read_text(encoding='utf-8')})")
    else:
        print("[대기열] 꺼져 있음 (stop으로 껐거나 죽음. queue.log 끝 확인)")
    load = server_load()
    if load:
        print(load)
    for run in queue["runs"]:
        name = run["name"]
        print(f"== {name}: {run_state(st, name)}")
        for line in tail_lines(st / f"{name}.log", 2, "[train]"):
            print(f"   {line}")
        csv_path = run_dir / CODE_SUBDIR / queue["out_root"] / name / "log.csv"
        for line in tail_lines(csv_path, 2):
            print(f"   log.csv: {','.join(line.split(',')[:7])}")
    for line in tail_lines(st / "queue.log", 2):
        print(f"[queue.log] {line}")
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    st = status_dir(Path(args.run_dir).expanduser())
    pid = read_pid(st / "queue.pid")
    if pid is None or not pid_alive(pid):
        print("도는 대기열 없음")
        return 0
    # start_new_session으로 띄워서 대기열 pid가 프로세스 묶음 번호. 학습·데이터 읽기 작업까지 같이 끔
    os.killpg(pid, signal.SIGTERM)
    print(f"대기열 묶음 {pid}에 종료 신호 보냄. 몇 초 뒤 status로 '멈춤' 확인")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("start", help="코드 사본 준비 후 대기열을 백그라운드로 띄움")
    s.add_argument("--run-dir", required=True, help="실행 폴더 (예: ~/ssaplash/runs/164-train)")
    s.add_argument("--zip", required=True, help="코드 zip (코드 사본이 없을 때만 풂)")
    s.add_argument("--shared-ai", required=True, help="data 폴더가 있는 공유 AI 폴더")
    s.add_argument(
        "--run", action="append", required=True, help="학습이름=학습 설정 yaml, 적은 순서대로 돌림"
    )
    s.add_argument(
        "--out-root", default="data/models/adtof_ft", help="학습 결과 폴더 (코드 사본 기준)"
    )
    s.add_argument("--num-workers", type=int, default=8, help="학습 하나의 데이터 읽기 작업 수")
    s.add_argument("--nice", type=int, default=19, help="우선순위 낮추기 (19가 가장 낮음)")
    s.add_argument(
        "--parallel", type=int, default=1, help="동시에 돌릴 학습 수 (1이면 하나씩, 적은 순서대로)"
    )
    s.add_argument(
        "--cpus",
        default=None,
        help="학습을 묶을 코어 목록, taskset -c 형식 (예: 0-95). 없으면 안 묶음",
    )
    s.add_argument("--python", default=sys.executable, help="학습에 쓸 파이썬 (공유 .venv)")
    s.set_defaults(func=cmd_start)

    r = sub.add_parser("run", help="(start가 부름) 대기열 본체")
    r.add_argument("--run-dir", required=True)
    r.set_defaults(func=cmd_run)

    t = sub.add_parser("status", help="학습별 상태·로그 끝·서버 load (여러 번 쳐도 됨)")
    t.add_argument("--run-dir", required=True)
    t.set_defaults(func=cmd_status)

    k = sub.add_parser("stop", help="대기열과 도는 학습을 끔 (이어 학습 가능)")
    k.add_argument("--run-dir", required=True)
    k.set_defaults(func=cmd_stop)
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
