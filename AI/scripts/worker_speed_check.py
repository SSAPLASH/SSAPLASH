"""운영 워커 처리 시간이 fake BE 측정보다 느린 원인 측정 (ai_2_to_4 3-C, 11/10).

사이트에서 곡을 올렸을 때와 같은 흐름을 서버 안에서 재현함: fake BE(BE 워커 API·저장소 대역)에 곡들을 작업으로
넣고, 운영과 같은 `ssaplash-worker run`을 따로 띄워 claim → 원곡 내려받기 → 음악 여부 검사 → 분리 → flac 올리기 → 분리 결과 제출 →
재조회 → 채보 → 채보 결과 제출을 곡마다 끝까지 돌림. 운영과 다른 점은 BE·저장소가 같은 서버(localhost)라
EC2까지 오가는 네트워크 시간이 빠진다는 것 하나뿐. 그 시간은 운영 워커 로그의 실제 작업들로 따로 봄.

채보 설정은 서비스 설정 그대로(service)와 드럼 킷 분리 겹침만 줄인 채보(drumsep_overlap_N) 중 고름.
겹침 변형은 SSAPLASH_CHART_MODEL이 ADTOF 계열(original·songsterr_avg)일 때만 되고, 드럼 킷 분리를 안 쓰는
서비스 기본 STRUM에서는 --skip-variant를 줌.
--threads로 워커 CPU 스레드 수(OMP·MKL·OpenBLAS·NumExpr 환경 변수)를 바꿔 가며 같은 곡들을 돌릴 수 있음. --rounds 2면
설정 순서를 한 번 뒤집어 한 번 더 돌려, 시간이 지나며 서버 상태가 바뀐 효과가 한 설정에만 몰리지 않게 함.
돌리는 동안 GPU 사용률·메모리·그 GPU를 쓰는 프로세스 수·서버 load·워커 프로세스 CPU 사용률을 1초마다 기록해
작업마다 평균을 붙임.

서버 예:
  CUDA_VISIBLE_DEVICES=6 .venv/bin/python ~/ssaplash/notebooks/worker_speed_check.py \
      --song-dir ~/ssaplash/upload/speed_songs --gpu-index 6 \
      --worker-log ~/ssaplash/results/worker.log --out ~/ssaplash/results/worker-speed
  스레드 비교: 위 명령에 --only-variant --threads default,16,4 --rounds 2 (--out은 다른 폴더)
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import psutil
import yaml

TR_CONFIG = Path("configs/chart/transcription.yaml")
THREAD_ENV = ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS")
AUDIO_EXT = (".mp3", ".wav", ".flac", ".m4a", ".opus", ".ogg")
LOG_TIME = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{3}) ")
JOB_START = re.compile(r"작업 (\d+) 시작")
JOB_SEP_DONE = re.compile(r"작업 (\d+) 분리 결과 인수")
JOB_END = re.compile(
    r"작업 (\d+) 끝: (\S+).*\(([\d.]+)초, 분리 (\S+) ms, 채보 (\S+) ms, 노트 (\S+)\)"
)


def log(msg: str) -> None:
    print(f"[speed] {datetime.now():%H:%M:%S} {msg}", flush=True)


# ---- GPU·서버 상태 기록 ----


def _smi(args: list[str]) -> list[str]:
    try:
        out = subprocess.run(
            ["nvidia-smi", *args], capture_output=True, text=True, timeout=10, check=False
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def _loadavg() -> str:
    try:
        return Path("/proc/loadavg").read_text().split()[0]
    except OSError:
        return ""


class Sampler(threading.Thread):
    """1초마다 지정 GPU의 사용률·메모리·프로세스 수, 서버 load를 csv로 기록."""

    def __init__(self, gpu_index: str, path: Path) -> None:
        super().__init__(daemon=True)
        self.gpu_index = gpu_index
        self.path = path
        self.stage = "idle"
        self.pid: int | None = None
        self.rows: list[dict] = []
        self._stop_evt = threading.Event()
        bus = _smi(["-i", gpu_index, "--query-gpu=pci.bus_id", "--format=csv,noheader"])
        self.bus_id = bus[0] if bus else ""

    def run(self) -> None:
        with open(self.path, "w", newline="", encoding="utf-8") as fh:
            fields = ["time", "stage", "gpu_util", "gpu_mem_mib", "n_procs", "load1", "worker_cpu"]
            w = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
            w.writeheader()
            # 워커와 그 자식 프로세스 (Windows 가상환경 python은 실행기가 실제 python을 자식으로 띄움)
            procs: dict[int, psutil.Process] = {}
            proc_pid = None
            while not self._stop_evt.is_set():
                cpu = ""
                if self.pid != proc_pid:
                    proc_pid, procs = self.pid, {}
                if proc_pid:
                    total, measured = 0.0, False
                    try:
                        root = psutil.Process(proc_pid)
                        family = [root, *root.children(recursive=True)]
                    except psutil.Error:
                        family = []
                    for p in family:
                        try:
                            if p.pid not in procs:
                                procs[p.pid] = p
                                p.cpu_percent(None)  # 첫 호출은 기준점이라 0
                                continue
                            total += procs[p.pid].cpu_percent(None)
                            measured = True
                        except psutil.Error:
                            procs.pop(p.pid, None)
                    if measured:
                        cpu = round(total)
                q = "--query-gpu=utilization.gpu,memory.used"
                row = _smi(["-i", self.gpu_index, q, "--format=csv,noheader,nounits"])
                util, mem = (row[0].split(",") + ["", ""])[:2] if row else ("", "")
                apps = _smi(["--query-compute-apps=gpu_bus_id,pid", "--format=csv,noheader"])
                n = sum(1 for a in apps if self.bus_id and a.startswith(self.bus_id))
                rec = {
                    "time": round(time.time(), 1),
                    "stage": self.stage,
                    "gpu_util": util.strip(),
                    "gpu_mem_mib": mem.strip(),
                    "n_procs": n,
                    "load1": _loadavg(),
                    "worker_cpu": cpu,
                }
                self.rows.append(rec)
                w.writerow(rec)
                fh.flush()
                self._stop_evt.wait(1.0)

    def window(self, start: float, end: float) -> dict:
        """start~end 사이 기록의 평균 GPU 사용률·최대 프로세스 수·평균 load."""
        rows = [r for r in list(self.rows) if start <= r["time"] <= end]
        util = [float(r["gpu_util"]) for r in rows if r["gpu_util"]]
        load = [float(r["load1"]) for r in rows if r["load1"]]
        cpu = [float(r["worker_cpu"]) for r in rows if r["worker_cpu"] != ""]
        return {
            "gpu_util": round(statistics.mean(util)) if util else None,
            "gpu_procs_max": max((int(r["n_procs"]) for r in rows), default=None),
            "load1": round(statistics.mean(load)) if load else None,
            "worker_cpu": round(statistics.mean(cpu)) if cpu else None,
        }

    def stop(self) -> None:
        self._stop_evt.set()
        self.join(timeout=5)


# ---- 설정 ----


def drumsep_variant_config(tmp: Path, overlap: int) -> Path:
    """서비스 채보 설정에서 지금 고른 모델의 드럼 킷 분리 겹침만 바꾼 설정 파일. 가중치 폴더는 그대로."""
    raw = yaml.safe_load(TR_CONFIG.read_text(encoding="utf-8"))
    name = os.environ.get("SSAPLASH_CHART_MODEL") or raw["model"]
    model = yaml.safe_load(Path(raw["models"][name]).read_text(encoding="utf-8"))
    ds = yaml.safe_load(Path(model["drumsep_config"]).read_text(encoding="utf-8"))
    ds["overlap"] = overlap
    tmp.mkdir(parents=True, exist_ok=True)
    ds_out = tmp / f"drumsep_ov{overlap}.yaml"
    ds_out.write_text(yaml.safe_dump(ds, allow_unicode=True), encoding="utf-8")
    model["drumsep_config"] = str(ds_out)
    model_out = tmp / f"transcriber_ov{overlap}.yaml"
    model_out.write_text(yaml.safe_dump(model, allow_unicode=True), encoding="utf-8")
    raw["models"][name] = str(model_out)
    tr_out = tmp / f"transcription_ov{overlap}.yaml"
    tr_out.write_text(yaml.safe_dump(raw, allow_unicode=True), encoding="utf-8")
    return tr_out


def note_agreement(a: dict, b: dict, tol_ms: int = 25) -> tuple[int, int, float]:
    """두 채보 JSON의 노트 일치. 같은 패드·tol_ms 안을 하나씩 짝지음 → (a 노트 수, b 노트 수, F1)."""
    na = [(n["pad"], n["timeMs"]) for n in a["charts"][0]["notes"]]
    nb = [(n["pad"], n["timeMs"]) for n in b["charts"][0]["notes"]]
    matched = 0
    for pad in {p for p, _ in na} | {p for p, _ in nb}:
        ta = sorted(t for p, t in na if p == pad)
        tb = sorted(t for p, t in nb if p == pad)
        i = j = 0
        while i < len(ta) and j < len(tb):
            if abs(ta[i] - tb[j]) <= tol_ms:
                matched += 1
                i += 1
                j += 1
            elif ta[i] < tb[j]:
                i += 1
            else:
                j += 1
    total = len(na) + len(nb)
    return len(na), len(nb), (2 * matched / total if total else 1.0)


# ---- 워커 로그 ----


def _ts(line: str) -> float | None:
    m = LOG_TIME.match(line)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").timestamp() + int(m.group(2)) / 1000


def _sec(ms: str) -> float | None:
    try:
        return float(ms) / 1000
    except ValueError:
        return None


def parse_worker_log(path: Path) -> list[dict]:
    """워커 로그 → 끝난 작업별 시간. 같은 작업 번호가 다시 나오면(재배정·재기동) 마지막 시도만 씀.

    sep_outside_sec = 분리 결과 인수 시각 − 작업 시작 − 분리 모델 시간
    (내려받기·음악 여부 검사·읽기·flac 쓰기·올리기·제출)
    tr_outside_sec = 작업 끝 − 분리 결과 인수 − 채보 모델 시간 (재조회·읽기·Beat This!·JSON·제출)
    """
    jobs: dict[str, dict] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        t = _ts(line)
        if t is None:
            continue
        if m := JOB_START.search(line):
            jobs[m.group(1)] = {"job": m.group(1), "start_ts": t}
        elif (m := JOB_SEP_DONE.search(line)) and m.group(1) in jobs:
            jobs[m.group(1)]["sep_ts"] = t
        elif (m := JOB_END.search(line)) and m.group(1) in jobs:
            jobs[m.group(1)].update(
                end_ts=t,
                status=m.group(2),
                total_sec=float(m.group(3)),
                separate_sec=_sec(m.group(4)),
                transcribe_sec=_sec(m.group(5)),
                notes=m.group(6),
            )
    rows = []
    for j in jobs.values():
        if "end_ts" not in j:
            continue
        sep_ts, sep, tr = j.get("sep_ts"), j.get("separate_sec"), j.get("transcribe_sec")
        rows.append(
            {
                "job": j["job"],
                "start": datetime.fromtimestamp(j["start_ts"]).strftime("%m-%d %H:%M:%S"),
                "status": j["status"],
                "total_sec": j["total_sec"],
                "separate_sec": sep,
                "sep_outside_sec": round(sep_ts - j["start_ts"] - sep, 1)
                if sep_ts and sep
                else None,
                "transcribe_sec": tr,
                "tr_outside_sec": round(j["end_ts"] - sep_ts - tr, 1) if sep_ts and tr else None,
                "notes": j["notes"],
                "start_ts": j["start_ts"],
                "end_ts": j["end_ts"],
            }
        )
    return rows


# ---- fake BE + 워커 한 번 ----


def run_setting(
    name: str,
    songs: list[Path],
    tr_config: Path,
    out: Path,
    sampler: Sampler,
    timeout: float,
    threads: str = "default",
    round_no: int = 1,
) -> list[dict]:
    """fake BE에 곡을 다 넣고 운영과 같은 워커를 띄워 전부 처리 → 작업별 행."""
    from ssaplash_ai.worker.fake_be import (
        DEFAULT_WORKER_ID,
        FAKE_TOKEN,
        FakeBackend,
        FakeBackendServer,
    )

    backend = FakeBackend(out_dir=None)
    song_of: dict[int, Path] = {}
    for s in songs:
        song_of[backend.enqueue(s)] = s
    server = FakeBackendServer(backend)
    server.start()
    run_id = f"{name}_r{round_no}"
    work = out / "work" / run_id
    work.mkdir(parents=True, exist_ok=True)
    env = dict(
        os.environ,
        SSAPLASH_WORKER_BASE_URL=server.base_url,
        SSAPLASH_WORKER_ID=DEFAULT_WORKER_ID,
        SSAPLASH_WORKER_TOKEN=FAKE_TOKEN,
        SSAPLASH_WORK_DIR=str(work),
        SSAPLASH_WORKER_POLL_SEC="1",
        # Jupyter 커널이 넘겨주는 inline 그림 설정은 워커 환경에 없어 모델 올리기가 실패함. 운영처럼 Agg로 고정
        MPLBACKEND="Agg",
    )
    env.pop("SSAPLASH_WORKER_KEEP_FILES", None)
    for k in THREAD_ENV:
        env.pop(k, None)
        if threads != "default":
            env[k] = threads
    worker_log = out / f"worker_{run_id}.log"
    cmd = [
        sys.executable,
        "-m",
        "ssaplash_ai.worker.cli",
        "run",
        "--max-jobs",
        str(len(songs)),
        "--transcription-config",
        str(tr_config),
    ]
    log(f"{run_id}: 곡 {len(songs)}개로 워커 시작 (스레드 {threads}). 로그 {worker_log}")
    sampler.stage = run_id
    with open(worker_log, "w", encoding="utf-8") as fh:
        proc = subprocess.Popen(cmd, stdout=fh, stderr=subprocess.STDOUT, env=env)
        sampler.pid = proc.pid
        deadline = time.monotonic() + timeout
        last_done = -1
        while proc.poll() is None:
            done = sum(1 for j in backend.jobs.values() if j.status in ("DONE", "FAILED"))
            if done != last_done:
                log(f"{run_id}: {done}/{len(songs)} 끝남")
                last_done = done
            if time.monotonic() > deadline:
                log(f"{run_id}: 시간 초과로 워커를 멈춤")
                proc.terminate()
                proc.wait(timeout=60)
                break
            time.sleep(2)
    server.stop()
    sampler.stage = "idle"
    sampler.pid = None
    rows = []
    by_job = {r["job"]: r for r in parse_worker_log(worker_log)}
    for order, (job_id, song) in enumerate(sorted(song_of.items()), start=1):
        j = backend.jobs[job_id]
        r = by_job.get(str(job_id), {})
        row = {
            "setting": name,
            "round": round_no,
            "order": order,
            "song": song.stem,
            "length_sec": round(j.duration_ms / 1000, 1),
            "status": j.status,
            **{k: r.get(k) for k in ("total_sec", "separate_sec", "sep_outside_sec")},
            **{k: r.get(k) for k in ("transcribe_sec", "tr_outside_sec", "notes")},
        }
        if r.get("start_ts"):
            row.update(sampler.window(r["start_ts"], r["end_ts"]))
        row["_chart"] = j.transcription_result
        rows.append(row)
    shutil.rmtree(work, ignore_errors=True)
    log(f"{run_id}: 끝. 종료 코드 {proc.returncode}")
    return rows


# ---- 요약 ----


def _med(rows: list[dict], key: str) -> str:
    vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
    return f"{statistics.median(vals):.1f}" if vals else ""


def _table(rows: list[dict], cols: list[str]) -> list[str]:
    out = ["| " + " | ".join(cols) + " |", "|" + " --- |" * len(cols)]
    for r in rows:
        out.append(
            "| " + " | ".join("" if r.get(c) is None else str(r.get(c)) for c in cols) + " |"
        )
    return out


def write_summary(
    path: Path, env: dict, results: dict, agree: list, real: list, overlap_jobs
) -> None:
    keys = ["total_sec", "separate_sec", "sep_outside_sec", "transcribe_sec", "tr_outside_sec"]
    lines = ["# 운영 워커 처리 시간 측정 (fake BE 전체 흐름)", ""]
    lines.append(
        f"GPU {env['gpu']}, torch {env['torch']}, 코어 {env['cpu_count']}, 시작 때 load {env['load1']}. "
        f"측정 중 운영 워커가 처리한 실제 작업: {', '.join(overlap_jobs) or '없음'}"
    )
    lines += ["", "## 설정별 중앙값 (초)", ""]
    extra = ["worker_cpu", "gpu_util", "load1"]
    med_rows = [
        {
            "setting": k,
            "jobs": sum(r["status"] == "DONE" for r in v),
            **{c: _med(v, c) for c in keys + extra},
        }
        for k, v in results.items()
    ]
    if real:
        med_rows.append(
            {
                "setting": "운영 워커 실제 작업",
                "jobs": len(real),
                **{c: _med(real, c) for c in keys},
            }
        )
    lines += _table(med_rows, ["setting", "jobs", *keys, *extra])
    for name, rows in results.items():
        lines += ["", f"## {name} 곡별 (초)", ""]
        cols = ["round", "order", "song", "length_sec", "status", *keys, "notes"]
        lines += _table(rows, [*cols, "worker_cpu", "gpu_util", "gpu_procs_max", "load1"])
    if agree:
        base = next(iter(results))
        lines += ["", f"## 노트 일치 ({base} 1회차 대비, 같은 패드·25ms 안)", ""]
        lines += _table(agree, ["setting", "song", "base_notes", "notes", "f1"])
    if real:
        lines += ["", "## 운영 워커 로그 실제 작업 (초)", ""]
        lines += _table(real, ["job", "start", "status", *keys, "notes"])
    lines += [
        "",
        "sep_outside_sec = 분리 결과 인수 시각 − 작업 시작 − 분리 모델 시간 (내려받기·읽기·flac 쓰기·올리기·제출). "
        "tr_outside_sec = 작업 끝 − 분리 결과 인수 − 채보 모델 시간 (재조회·읽기·Beat This!·JSON·제출). "
        "gpu_util·gpu_procs_max·load1·worker_cpu는 그 작업이 도는 동안 GPU 평균 사용률·그 GPU를 쓰는 최대 프로세스 수·"
        "서버 평균 load·워커 프로세스 평균 CPU 사용률(코어 하나 = 100)",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--song", action="append", default=[], help="원곡 파일. 여러 번 줄 수 있음")
    ap.add_argument("--song-dir", type=Path, help="이 폴더의 음원 파일 전부")
    ap.add_argument("--drumsep-overlap", type=int, default=2, help="비교할 드럼 킷 분리 겹침")
    ap.add_argument("--skip-variant", action="store_true", help="서비스 설정만 돌림")
    ap.add_argument("--only-variant", action="store_true", help="겹침 바꾼 채보 설정만 돌림")
    ap.add_argument(
        "--threads", default="default", help="워커 CPU 스레드 수 목록. 예: default,16,4"
    )
    ap.add_argument("--rounds", type=int, default=1, help="2면 설정 순서를 뒤집어 한 번 더 돌림")
    ap.add_argument("--gpu-index", default=os.environ.get("CUDA_VISIBLE_DEVICES", "0"))
    ap.add_argument("--worker-log", type=Path, help="운영 워커 로그. 실제 작업 시간을 같이 뽑음")
    ap.add_argument("--timeout-min", type=float, default=90.0, help="설정 하나당 최대 분")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    songs = [Path(s) for s in args.song]
    if args.song_dir:
        songs += sorted(p for p in args.song_dir.iterdir() if p.suffix.lower() in AUDIO_EXT)
    if not songs:
        print("곡이 없음. --song 또는 --song-dir", file=sys.stderr)
        return 1
    import torch

    args.out.mkdir(parents=True, exist_ok=True)
    env = {
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "torch": torch.__version__,
        "cpu_count": os.cpu_count(),
        "load1": _loadavg(),
    }
    log(f"환경 {env}, 곡 {len(songs)}개")
    configs = [] if args.only_variant else [("service", TR_CONFIG)]
    if not args.skip_variant:
        ov = args.drumsep_overlap
        configs.append((f"drumsep_overlap_{ov}", drumsep_variant_config(args.out / "configs", ov)))
    threads = [t.strip() for t in args.threads.split(",") if t.strip()]
    settings = [
        (cname if len(threads) == 1 else f"{cname}_threads_{t}", cfg, t)
        for cname, cfg in configs
        for t in threads
    ]
    order = list(settings)
    for r in range(2, args.rounds + 1):
        order += list(reversed(settings)) if r % 2 == 0 else list(settings)
    log(f"돌릴 순서: {[name for name, _, _ in order]}")
    sampler = Sampler(str(args.gpu_index), args.out / "gpu_samples.csv")
    sampler.start()
    began = time.time()
    results: dict[str, list[dict]] = {name: [] for name, _, _ in settings}
    seen: dict[str, int] = {}
    for name, cfg, t in order:
        seen[name] = seen.get(name, 0) + 1
        results[name] += run_setting(
            name, songs, cfg, args.out, sampler, args.timeout_min * 60, t, seen[name]
        )
    ended = time.time()
    sampler.stop()

    agree = []
    base_name = settings[0][0]
    base = {r["song"]: r["_chart"] for r in results[base_name] if r["round"] == 1}
    for name, rows in results.items():
        for r in rows:
            if (name, r["round"]) == (base_name, 1) or not r["_chart"] or not base.get(r["song"]):
                continue
            n1, n2, f1 = note_agreement(base[r["song"]], r["_chart"])
            agree.append(
                {
                    "setting": f"{name} {r['round']}회차",
                    "song": r["song"],
                    "base_notes": n1,
                    "notes": n2,
                    "f1": f"{f1:.3f}",
                }
            )
    plain = {
        k: [{c: v for c, v in r.items() if c != "_chart"} for r in rs] for k, rs in results.items()
    }
    rows_all = [r for rs in plain.values() for r in rs]
    with open(args.out / "runs.csv", "w", newline="", encoding="utf-8") as fh:
        fields = list(dict.fromkeys(k for r in rows_all for k in r))
        w = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows_all)
    real = []
    if args.worker_log and args.worker_log.is_file():
        real = parse_worker_log(args.worker_log)
        if real:
            with open(args.out / "worker_jobs.csv", "w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=list(real[0]), lineterminator="\n")
                w.writeheader()
                w.writerows(real)
    overlap_jobs = [j["job"] for j in real if j["end_ts"] >= began and j["start_ts"] <= ended]
    write_summary(args.out / "summary.md", env, plain, agree, real, overlap_jobs)
    log(f"끝. 저장 {args.out / 'summary.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
