"""STRUM CRNN 실제 곡 학습 전체 과정을 한 번에 돌림 (11/11).

단계를 차례로 돌고, 끝난 단계마다 {work}/done/{단계}.json을 남김. 다시 실행하면 끝난 단계는 건너뛰고
학습은 각자 마지막 저장(last.pt)에서 이어 감. 운영 코드 폴더(--ai)는 .venv와 ssaplash_ai를 실행만 하고 아무것도 쓰지 않음.

단계
- check: GPU와 필요한 패키지 확인. 없는 패키지는 {work}/pylib에 받아 봄
- data: 올린 zip의 md5를 확인하고 {work}/ext_ft_data(음원·정답)·{work}/ext_ft_models(가중치·모델 코드)로 풂
- egmd: 서버에 있는 E-GMD 어쿠스틱 킷 학습 분할의 곡 목록·정답 만들기. 실패하면 E-GMD를 섞는 학습만 뺌
- train: 학습을 전부 동시에 실행. strum_p3_R은 실제 곡 457곡만, strum_p3_RE는 실제 곡 + E-GMD(구간의 30%)
- dump: 학습마다 검증 점수가 가장 높은 가중치로 검증·시험 곡을 채보해 프레임별 점수 저장
- pack: 학습 기록·로그·채보 결과를 {results}/{zip-name}.zip으로 묶음 (가중치는 {work}/runs에 남김)

  python ext_ft_pipeline.py run --work ~/ssaplash/ext_ft --upload ~/ssaplash/upload --ai ~/ssaplash/S15P31A307/AI \
      --egmd-root ~/ssaplash/datasets/e-gmd/e-gmd-v1.0.0 --results ~/ssaplash/results
  python ext_ft_pipeline.py status --work ~/ssaplash/ext_ft
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import subprocess
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVAL_SETS = ("val10", "test31", "holdout38", "mdb", "enst", "enst_sep")
# 불러와야 하는 패키지 (import 이름 → 받을 때 쓰는 이름)
NEEDS = {
    "strum": {
        "torch": "torch",
        "torchaudio": "torchaudio",
        "scipy": "scipy",
        "soundfile": "soundfile",
    },
}
# 운영 환경과 버전이 맞아야 해서 받지 않는 패키지. 없으면 학습을 시작하지 않음
HEAVY = {"torch", "torchaudio", "numpy", "scipy"}
MAX_FETCH = 25  # 한 모델에서 차례로 받아 보는 패키지 수 한도


def run_specs(args: argparse.Namespace) -> dict[str, dict]:
    """학습 이름 → 모델 종류·스크립트·인자. 스텝 수는 --scale로 줄일 수 있음(동작 확인용)."""
    models = args.work / "ext_ft_models"

    def steps(n: int) -> str:
        return str(max(int(n * args.scale), 20))

    def every(n: int) -> str:
        return str(max(int(n * args.scale), 10))

    small = args.scale < 0.05  # 동작 확인용: 배치도 줄임
    strum = ["--model-py", str(models / "strum" / "drums_v13.py"), "--batch", "2" if small else "8", "--seconds", "10",
             "--steps", steps(8000), "--eval-every", every(500), "--lr", "3e-5", "--spec-augment",
             "--accomp-prob", "0"]  # fmt: skip
    p3 = ["--weights", str(models / "strum" / "phase3.pt")]
    out = {}
    # _R은 실제 곡만, _RE는 실제 곡 + E-GMD. 서비스 가중치는 strum_p3_RE의 best.pt
    for suffix in ("R", "RE"):
        out[f"strum_p3_{suffix}"] = {
            "model": "strum",
            "script": "strum_crnn.py",
            "train": [*p3, *strum],
            "dump": [*p3, "--model-py", strum[1]],
            "egmd": suffix == "RE",
            "share": 0.3,
        }
    return out


def log(text: str) -> None:
    print(f"[{time.strftime('%m-%d %H:%M:%S')}] {text}", flush=True)


class Ctx:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.work: Path = args.work
        self.done = self.work / "done"
        self.runs = self.work / "runs"
        self.data = self.work / "ext_ft_data"
        self.state_path = self.work / "state.json"
        for d in (self.done, self.runs, self.work / "logs"):
            d.mkdir(parents=True, exist_ok=True)

    def state(self) -> dict:
        if self.state_path.is_file():
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        return {}

    def save_state(self, **kw) -> None:
        st = self.state()
        st.update(kw)
        self.state_path.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")

    def is_done(self, stage: str) -> bool:
        return (self.done / f"{stage}.json").is_file()

    def mark_done(self, stage: str, info: dict) -> None:
        (self.done / f"{stage}.json").write_text(
            json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8"
        )

    def env(self) -> dict:
        env = dict(os.environ, PYTHONUTF8="1", PYTHONUNBUFFERED="1")
        for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
            env[key] = "1"  # 데이터 읽기 작업마다 코어를 다 쓰지 않게 (공용 서버)
        pylib = self.work / "pylib"
        env["PYTHONPATH"] = str(pylib) if pylib.is_dir() else ""
        return env

    def python(self) -> list[str]:
        return shlex.split(self.args.vpy)


# ---------- 단계 ----------


def first_problem(ctx: Ctx, statements: list[str]) -> tuple[str, str, str] | None:
    """운영 python에서 처음 실패하는 문장. (문장, 없는 모듈 이름, 오류 글). 전부 되면 None.

    안쪽 오류를 감싸 다시 던지는 패키지가 있어, 원인 사슬을 따라가 가장 안쪽의 없는 모듈을 찾음.
    """
    lines = [
        "import json, re",
        "def inner(e):",
        "    name, n = '', 0",
        "    while e is not None and n < 12:",
        "        if isinstance(e, ModuleNotFoundError) and e.name:",
        "            name = e.name",
        "        else:",
        "            m = re.search(r\"No module named '([^']+)'\", str(e))",
        "            name = m.group(1) if m else name",
        "        e, n = (e.__cause__ or e.__context__), n + 1",
        "    return name",
        "found = None",
        f"for s in {statements!r}:",
        "    try:",
        "        exec(s, {})",
        "    except Exception as e:",
        "        found = [s, inner(e), (type(e).__name__ + ': ' + str(e))[-400:]]",
        "        break",
        "print('PROBLEM=' + json.dumps(found))",
    ]
    code = chr(10).join(lines)
    out = subprocess.run([*ctx.python(), "-c", code], capture_output=True, text=True, env=ctx.env())
    for line in out.stdout.splitlines():
        if line.startswith("PROBLEM="):
            found = json.loads(line[len("PROBLEM=") :])
            return tuple(found) if found else None
    return (statements[0], "", out.stderr.strip()[-400:])


def fetch(ctx: Ctx, package: str) -> bool:
    """패키지 하나를 {work}/pylib에 받음(의존 패키지는 따로 하나씩 확인해 받음)."""
    pylib = ctx.work / "pylib"
    cmd = [*shlex.split(ctx.args.uv), "pip", "install", "--python", ctx.python()[0],
           "--target", str(pylib), "--no-deps", package]  # fmt: skip
    got = subprocess.run(cmd, capture_output=True, text=True)
    if got.returncode != 0:
        log(f"  {package} 받기 실패: {got.stderr.strip()[-300:]}")
    return got.returncode == 0


def stage_check(ctx: Ctx) -> dict:
    code = "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.device_count())"
    out = subprocess.run([*ctx.python(), "-c", code], capture_output=True, text=True, env=ctx.env())
    log(f"torch: {out.stdout.strip() or out.stderr.strip()[-300:]}")
    if "True" not in out.stdout:
        raise RuntimeError("GPU가 안 보임. CUDA_VISIBLE_DEVICES와 torch 설치를 확인")
    usable, skipped = [], {}
    for model, needs in NEEDS.items():
        statements = [f"import {m}" for m in needs]
        tried: set[str] = set()
        problem = first_problem(ctx, statements)
        while problem and len(tried) < MAX_FETCH:
            top = problem[1].split(".")[0]
            if not top or top in HEAVY or top in tried:
                break
            tried.add(top)
            package = needs.get(top) or top
            log(f"{model}: {top} 없음 → {package}를 {ctx.work / 'pylib'}에 받음")
            if not fetch(ctx, package):
                break
            problem = first_problem(ctx, statements)
        if problem:
            skipped[model] = [problem[1] or problem[0]]
            log(f"{model}: '{problem[0]}'가 안 돼 이 모델 학습은 뺌 → {problem[2]}")
        else:
            usable.append(model)
    if not usable:
        raise RuntimeError(f"돌릴 수 있는 모델이 없음: {skipped}")
    return {"models": usable, "skipped": skipped, "torch": out.stdout.strip()}


def md5_of(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


def stage_data(ctx: Ctx) -> dict:
    expect = json.loads((HERE / "md5.json").read_text(encoding="utf-8"))
    problems = []
    for name, info in expect.items():
        path = ctx.args.upload / name
        if not path.is_file():
            problems.append(f"{name}: 없음")
        elif path.stat().st_size != info["bytes"]:
            problems.append(
                f"{name}: 크기 {path.stat().st_size} (맞는 값 {info['bytes']}). 덜 올라감"
            )
        elif md5_of(path) != info["md5"]:
            problems.append(f"{name}: md5가 다름. 다시 올려야 함")
        else:
            log(f"{name}: 확인")
    if problems:
        raise RuntimeError("올린 파일 문제 → " + " / ".join(problems))
    for name in expect:
        with zipfile.ZipFile(ctx.args.upload / name) as zf:
            zf.extractall(ctx.work)
        log(f"{name}: 풂")
    songs = {}
    for name in ("train457", *EVAL_SETS):
        songs[name] = len(
            json.loads((ctx.data / f"{name}.json").read_text(encoding="utf-8"))["songs"]
        )
    return {"songs": songs}


def stage_egmd(ctx: Ctx) -> dict:
    """E-GMD 어쿠스틱 킷 학습 분할 목록. 운영 코드의 로더(ssaplash_ai)로 정답을 읽음."""
    root = ctx.args.egmd_root
    if not (root / "e-gmd-v1.0.0.csv").is_file():
        log(f"E-GMD가 없음: {root}. E-GMD를 섞는 학습(_RE)은 뺌")
        return {"ok": False, "reason": f"{root}에 e-gmd-v1.0.0.csv 없음"}
    text = (HERE / "egmd_train_acoustic.yaml").read_text(encoding="utf-8")
    lines = [f"root: {root}" if ln.startswith("root:") else ln for ln in text.splitlines()]
    yaml_path = ctx.work / "egmd_train_acoustic.yaml"
    yaml_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    cmd = [*ctx.python(), str(HERE / "export_manifest.py"), "--dataset", str(yaml_path),
           "--name", "egmd_train", "--audio", "original", "--out", str(ctx.work / "egmd")]  # fmt: skip
    with open(ctx.work / "logs" / "egmd.log", "a", encoding="utf-8") as fh:
        code = subprocess.run(
            cmd, cwd=ctx.args.ai, env=ctx.env(), stdout=fh, stderr=subprocess.STDOUT
        )
    manifest = ctx.work / "egmd" / "egmd_train.json"
    if code.returncode != 0 or not manifest.is_file():
        log("E-GMD 목록 만들기 실패(logs/egmd.log). E-GMD를 섞는 학습(_RE)은 뺌")
        return {"ok": False, "reason": "export_manifest 실패"}
    n = len(json.loads(manifest.read_text(encoding="utf-8"))["songs"])
    log(f"E-GMD 목록 {n}곡")
    if n < 100:
        log("E-GMD 곡이 100곡보다 적음. E-GMD를 섞는 학습(_RE)은 뺌")
        return {"ok": False, "reason": f"곡 {n}개뿐", "songs": n}
    return {"ok": True, "songs": n, "manifest": str(manifest)}


def read_done(ctx: Ctx, stage: str) -> dict:
    path = ctx.done / f"{stage}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def active_runs(ctx: Ctx) -> dict[str, dict]:
    check, egmd = (read_done(ctx, s) for s in ("check", "egmd"))
    wanted = tuple(x for x in ctx.args.runs.split(",") if x)  # 비우면 전부
    out = {}
    for name, spec in run_specs(ctx.args).items():
        if spec["model"] not in check["models"] or (spec["egmd"] and not egmd.get("ok")):
            continue
        if wanted and name not in wanted:
            continue
        out[name] = spec
    return out


def train_cmd(ctx: Ctx, name: str, spec: dict) -> list[str]:
    # 구간을 뽑는 비율: E-GMD(share), 나머지는 실제 곡
    share = spec["share"] if spec["egmd"] else 0.0
    real = ctx.data / "train457.json"
    cmd = [*ctx.python(), str(HERE / spec["script"]), "train", *spec["train"],
           "--train", f"{real}:{1 - share:g}" if share > 0 else str(real)]  # fmt: skip
    if share > 0:
        cmd += ["--train", f"{ctx.work / 'egmd' / 'egmd_train.json'}:{share:g}"]
    return [*cmd, "--val", str(ctx.data / "val10.json"), "--out", str(ctx.runs / name)]


def dump_cmd(ctx: Ctx, name: str, spec: dict) -> list[str]:
    best = str(ctx.runs / name / "best.pt")
    sets = [x for n in EVAL_SETS for x in ("--manifest", str(ctx.data / f"{n}.json"))]
    cmd = [*ctx.python(), str(HERE / spec["script"]), "dump", *spec["dump"], "--checkpoint", best]
    return [*cmd, "--tag", name, "--acts", str(ctx.work / "acts"), *sets]


def run_parallel(ctx: Ctx, kind: str, cmds: dict[str, list[str]]) -> dict:
    """명령을 전부 동시에 실행하고 끝날 때까지 기다림. 이미 끝난 것은 건너뜀. 실패한 것은 기록만 하고 계속."""
    procs, result, waiting = {}, {}, []
    for name, cmd in cmds.items():
        if (ctx.done / f"{kind}_{name}.json").is_file():
            result[name] = "이미 끝남"
        else:
            waiting.append((name, cmd))
    limit = ctx.args.parallel or len(waiting)
    while procs or waiting:
        while waiting and len(procs) < limit:
            name, cmd = waiting.pop(0)
            fh = open(ctx.work / "logs" / f"{kind}_{name}.log", "a", encoding="utf-8")
            proc = subprocess.Popen(
                cmd, cwd=ctx.work, env=ctx.env(), stdout=fh, stderr=subprocess.STDOUT
            )
            procs[name] = (proc, fh)
            log(f"{kind} {name}: 시작 (pid {proc.pid})")
        time.sleep(ctx.args.poll)
        for name in list(procs):
            proc, fh = procs[name]
            code = proc.poll()
            if code is None:
                continue
            fh.close()
            del procs[name]
            finished = kind == "train" and (ctx.runs / name / "done.json").is_file()
            if code == 0 or finished:
                (ctx.done / f"{kind}_{name}.json").write_text(
                    json.dumps({"ok": True}), encoding="utf-8"
                )
                result[name] = "끝"
            else:
                result[name] = f"실패 (exit {code})"
            log(f"{kind} {name}: {result[name]}")
    return result


def stage_train(ctx: Ctx) -> dict:
    runs = active_runs(ctx)
    ctx.save_state(runs=list(runs))
    result = run_parallel(ctx, "train", {n: train_cmd(ctx, n, s) for n, s in runs.items()})
    if not any(v in ("끝", "이미 끝남") for v in result.values()):
        raise RuntimeError(f"끝난 학습이 없음: {result}")
    return {"runs": result}


def stage_dump(ctx: Ctx) -> dict:
    runs = {n: s for n, s in active_runs(ctx).items() if (ctx.runs / n / "best.pt").is_file()}
    return {"runs": run_parallel(ctx, "dump", {n: dump_cmd(ctx, n, s) for n, s in runs.items()})}


def stage_pack(ctx: Ctx) -> dict:
    files = [ctx.state_path, ctx.work / "pipeline.log"]
    files += sorted(ctx.done.glob("*.json")) + sorted((ctx.work / "logs").glob("*.log"))
    for run in sorted(ctx.runs.iterdir()):
        files += [run / "train_log.jsonl", run / "args.json"]
    if (ctx.work / "acts").is_dir():
        files += sorted(p for p in (ctx.work / "acts").rglob("*.npz"))
    files = [p for p in files if p.is_file()]
    ctx.args.results.mkdir(parents=True, exist_ok=True)
    stem = ctx.args.zip_name
    dest = ctx.args.results / f"{stem}.zip"
    tmp = dest.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in files:
            zf.write(p, f"{stem}/{p.relative_to(ctx.work).as_posix()}")
    tmp.replace(dest)
    log(f"묶음 {dest} ({dest.stat().st_size / 2**20:.1f}MB, 파일 {len(files)}개)")
    return {"zip": str(dest), "files": len(files)}


STAGES = {
    "check": stage_check,
    "data": stage_data,
    "egmd": stage_egmd,
    "train": stage_train,
    "dump": stage_dump,
    "pack": stage_pack,
}


def cmd_run(args: argparse.Namespace) -> int:
    ctx = Ctx(args)
    ctx.save_state(pid=os.getpid(), started=time.strftime("%Y-%m-%d %H:%M:%S"), current="시작")
    for stage, fn in STAGES.items():
        if ctx.is_done(stage):
            info = json.loads((ctx.done / f"{stage}.json").read_text(encoding="utf-8"))
            # 패키지가 없어 빠진 모델이 있으면, 학습을 시작하기 전까지는 다시 실행할 때 패키지를 다시 확인함
            if stage == "check" and info.get("skipped") and not ctx.is_done("train"):
                log("check: 빠진 모델이 있어 다시 확인")
            else:
                log(f"{stage}: 이미 끝남, 건너뜀")
                continue
        t0 = time.time()
        log(f"{stage}: 시작")
        ctx.save_state(current=stage, current_started=time.strftime("%Y-%m-%d %H:%M:%S"))
        info = fn(ctx)
        info["minutes"] = round((time.time() - t0) / 60, 1)
        ctx.mark_done(stage, info)
    ctx.save_state(current="끝", finished=time.strftime("%Y-%m-%d %H:%M:%S"))
    log("전체 끝")
    return 0


# ---------- 진행 확인 ----------


def pid_alive(pid) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (OSError, ValueError):
        return False
    # 죽었는데 노트북 커널이 아직 거두지 않은 프로세스(상태 Z)는 죽은 것으로 봄
    try:
        stat = Path(f"/proc/{int(pid)}/stat").read_text()
    except OSError:
        return True
    return stat.rsplit(")", 1)[-1].split()[:1] != ["Z"]


def tail(path: Path, n: int = 1) -> list[str]:
    if not path.is_file():
        return []
    with open(path, "rb") as fh:
        fh.seek(0, 2)
        fh.seek(max(fh.tell() - 4000, 0))
        text = fh.read().decode("utf-8", errors="replace")
    return [ln for ln in text.splitlines() if ln.strip()][-n:]


def cmd_status(args: argparse.Namespace) -> int:
    work = args.work
    sp = work / "state.json"
    if not sp.is_file():
        print("아직 시작 안 함")
        return 0
    st = json.loads(sp.read_text(encoding="utf-8"))
    alive = pid_alive(st.get("pid"))
    word = "도는 중" if alive else "끝남" if st.get("current") == "끝" else "멈춤"
    print(f"파이프라인 {word} (pid {st.get('pid')}, 시작 {st.get('started')})")
    print(f"지금 단계: {st.get('current')} (시작 {st.get('current_started')})")
    for stage in STAGES:
        d = work / "done" / f"{stage}.json"
        if d.is_file():
            info = json.loads(d.read_text(encoding="utf-8"))
            brief = {
                k: v
                for k, v in info.items()
                if k in ("minutes", "models", "skipped", "songs", "ok", "reason", "runs", "zip")
            }
            print(f"  [끝] {stage} {brief}")
        else:
            print(f"  [ ] {stage}")
    for name in st.get("runs", []):
        logf = work / "runs" / name / "train_log.jsonl"
        rows = (
            [json.loads(x) for x in logf.read_text(encoding="utf-8").splitlines()]
            if logf.is_file()
            else []
        )
        line = (tail(work / "logs" / f"train_{name}.log") or [""])[0][:110]
        if rows:
            best = max(rows, key=lambda r: r["val"]["f1"])
            print(
                f"  {name}: 학습 전 {rows[0]['val']['f1']:.3f} → 최고 {best['val']['f1']:.3f} "
                f"(스텝 {best['step']}), 마지막 검증 스텝 {rows[-1]['step']} | {line}"
            )
        else:
            print(f"  {name}: 검증 기록 아직 없음 | {line}")
    if st.get("current") != "끝":
        print(f"지금 시각 {time.strftime('%Y-%m-%d %H:%M:%S')}. 파이프라인 로그 끝:")
        for ln in tail(work / "pipeline.log", 4):
            print("   ", ln[:300])
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--work", type=Path, required=True)
    r.add_argument("--upload", type=Path, required=True, help="올린 zip이 있는 폴더")
    r.add_argument(
        "--ai", type=Path, required=True, help="운영 코드 AI 폴더(ssaplash_ai를 불러올 곳)"
    )
    r.add_argument("--vpy", required=True, help="실행할 python (운영 .venv)")
    r.add_argument("--uv", default="uv", help="uv 실행 명령. 예: 'python -m uv'")
    r.add_argument("--egmd-root", type=Path, required=True)
    r.add_argument("--results", type=Path, required=True)
    r.add_argument("--runs", default="", help="쉼표로 구분한 학습 이름만 실행. 비우면 전부")
    r.add_argument("--zip-name", default="ext_ft_results", help="결과 zip 이름(확장자 제외)")
    r.add_argument("--scale", type=float, default=1.0, help="스텝 수 배수(동작 확인용)")
    r.add_argument("--parallel", type=int, default=0, help="동시에 돌릴 학습 수. 0이면 전부")
    r.add_argument("--poll", type=float, default=15.0, help="학습이 끝났는지 보는 간격(초)")
    s = sub.add_parser("status")
    s.add_argument("--work", type=Path, required=True)
    args = ap.parse_args()
    for key in ("work", "upload", "ai", "egmd_root", "results"):
        if getattr(args, key, None) is not None:
            setattr(args, key, Path(getattr(args, key)).expanduser().resolve())
    return cmd_run(args) if args.cmd == "run" else cmd_status(args)


if __name__ == "__main__":
    raise SystemExit(main())
