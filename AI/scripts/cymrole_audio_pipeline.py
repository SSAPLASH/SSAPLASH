"""서버에서 오디오 LLM 하이햇·라이드 판정을 끝까지 돌림 (11/09, 설계 CHART-003-audio-llm-cymbal, S15P31A307-325).

단계: check → 모델마다 [가상환경 → 공식 저장소 → 작은 시험(원곡·분리 드럼) → 통과 판단 → 통과한 오디오 전체 마디]
→ 결과 묶기. 단계가 끝나면 done/<단계> 파일을 남기고, 다시 실행하면 끝난 단계는 건너뜀.
모델 하나가 실패하면 failed/<단계>에 오류를 남기고 다음 모델로 넘어감(다시 실행하면 다시 시도).
운영 코드 폴더·운영 .venv는 건드리지 않음. 가상환경·가중치·저장소는 전부 작업 폴더 아래에 둠.
이 스크립트는 표준 라이브러리만 씀.

  nohup python scripts/cymrole_audio_pipeline.py run --work ~/ssaplash/cymrole_audio >> pipeline.log 2>&1 &
  python scripts/cymrole_audio_pipeline.py status --work ~/ssaplash/cymrole_audio
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

TORCH_CU128 = "https://download.pytorch.org/whl/cu128"
TORCH_CU124 = "https://download.pytorch.org/whl/cu124"
FA_WHEEL = ("https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/"
            "flash_attn-2.7.4.post1+cu12torch2.6cxx11abiFALSE-{py}-{py}-linux_x86_64.whl")  # fmt: skip

# 가상환경: (파이썬, 설치 명령 목록). 명령의 {repo}는 그 환경이 쓰는 공식 저장소 경로
ENVS = {
    "omni": (
        "3.12",
        [
            [
                "torch==2.9.1",
                "torchaudio==2.9.1",
                "torchvision==0.24.1",
                "--index-url",
                TORCH_CU128,
            ],
            [
                "transformers",
                "accelerate",
                "qwen-omni-utils",
                "audioread",  # qwen-omni-utils가 맨 위에서 불러오지만 의존 목록에 없음
                "mistral-common[audio]",
                "soundfile",
                "librosa",
                "numpy",
                "huggingface_hub[hf_xet]",
                "timm",
                "einops",
            ],
        ],
    ),
    "moss": (
        "3.12",
        [
            ["-e", "{repo}[torch-runtime]", "--extra-index-url", TORCH_CU128],
            ["soundfile", "huggingface_hub[hf_xet]"],
        ],
    ),
    "mimo": (
        "3.12",
        [
            ["torch==2.6.0", "torchaudio==2.6.0", "--index-url", TORCH_CU124],
            ["-r", "{repo}/requirements.txt", "--extra-index-url", TORCH_CU124],
            [FA_WHEEL.format(py="cp312")],
            ["soundfile", "huggingface_hub[hf_xet]"],
        ],
    ),
    "step": (
        "3.12",
        [
            ["torch==2.6.0", "torchaudio==2.6.0", "--index-url", TORCH_CU124],
            [
                "transformers==4.49.0",
                "accelerate",
                "librosa",
                "soundfile",
                "einops",
                "huggingface_hub[hf_xet]",
            ],
        ],
    ),
    "kimi": (
        "3.10",
        [
            ["torch==2.6.0", "torchaudio==2.6.0", "--index-url", TORCH_CU124],
            # 11/09 서버: portalocker가 PyTorch 저장소에도 있어 uv가 그쪽만 보다가 버전을 못 찾음
            [
                "-r",
                "{work}/kimi_requirements.txt",
                "--extra-index-url",
                TORCH_CU124,
                "--index-strategy",
                "unsafe-best-match",
            ],
            [FA_WHEEL.format(py="cp310")],
        ],
    ),
}
# 가상환경을 만든 뒤 알게 된 빠진 패키지. 판정 전마다 설치함(이미 있으면 바로 끝남)
EXTRAS = {"omni": ["audioread"]}  # qwen-omni-utils가 맨 위에서 불러오지만 의존 목록에 없음
REPOS = {
    "moss": "https://github.com/OpenMOSS/MOSS-Music.git",
    "mimo": "https://github.com/XiaomiMiMo/MiMo-Audio.git",
    "step": "https://github.com/stepfun-ai/Step-Audio2.git",
    "kimi": "https://github.com/MoonshotAI/Kimi-Audio.git",
}
# 백엔드: (가상환경, 가중치 저장소 목록). 순서대로 실행
MODELS = {
    "qwen3omni": ("omni", ["Qwen/Qwen3-Omni-30B-A3B-Instruct"]),
    "nemotron": ("omni", ["nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16"]),
    "voxtral": ("omni", ["mistralai/Voxtral-Small-24B-2507"]),
    "afnext": ("omni", ["nvidia/audio-flamingo-next-hf"]),
    "mossmusic": ("moss", ["OpenMOSS-Team/MOSS-Music-8B-Instruct"]),
    "mimoaudio": ("mimo", ["XiaomiMiMo/MiMo-Audio-7B-Instruct", "XiaomiMiMo/MiMo-Audio-Tokenizer"]),
    "stepaudio2": ("step", ["stepfun-ai/Step-Audio-2-mini"]),
    "kimiaudio": ("kimi", ["moonshotai/Kimi-Audio-7B-Instruct", "THUDM/glm-4-voice-tokenizer"]),
    "fake": ("omni", []),  # 로컬 시험용 가짜 백엔드
}
REAL_MODELS = [m for m in MODELS if m != "fake"]
AUDIOS = ("mix", "drums")


class Ctx:
    def __init__(self, args):
        self.a = args
        self.work = Path(args.work).expanduser().resolve()
        self.done = self.work / "done"
        self.failed = self.work / "failed"
        self.logs = self.work / "log"
        self.answers = self.work / "answers"
        for d in (self.done, self.failed, self.logs, self.answers):
            d.mkdir(parents=True, exist_ok=True)
        self.env = dict(os.environ, CUDA_VISIBLE_DEVICES=str(args.gpu), HF_HOME=str(self.work / "hf_cache"),
                        PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8", TOKENIZERS_PARALLELISM="false")  # fmt: skip

    def py(self, env: str) -> str:
        if self.a.python:  # 로컬 시험: 가상환경 대신 지정한 파이썬
            return self.a.python
        return str(self.work / "envs" / env / "bin" / "python")


def log(msg: str) -> None:
    print(f"[{time.strftime('%m-%d %H:%M:%S')}] {msg}", flush=True)


def sh(ctx: Ctx, cmd: list[str], logname: str, cwd: Path | None = None) -> None:
    """명령을 돌려 출력은 log/<logname>.log에 덧붙임. 실패하면 CalledProcessError."""
    with (ctx.logs / f"{logname}.log").open("a", encoding="utf-8") as fh:
        fh.write(f"\n$ {' '.join(cmd)}\n")
        fh.flush()
        subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, check=True, env=ctx.env, cwd=cwd)


def stage(ctx: Ctx, name: str, fn) -> bool:
    """done/<name>이 있으면 건너뜀. 성공하면 done, 실패하면 failed/<name>에 오류를 쓰고 False."""
    if (ctx.done / name).exists():
        return True
    log(f"시작 {name}")
    t = time.time()
    try:
        fn()
    except Exception as e:  # noqa: BLE001  # 모델 하나가 실패해도 다음 모델로
        (ctx.failed / name).write_text(f"{type(e).__name__}: {e}\n", encoding="utf-8")
        log(f"실패 {name}: {type(e).__name__}: {e} (log 폴더 확인)")
        return False
    (ctx.failed / name).unlink(missing_ok=True)
    (ctx.done / name).write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
    log(f"끝 {name} ({(time.time() - t) / 60:.1f}분)")
    return True


def gpu_free_gb(gpu: int) -> float | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=index,memory.free", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, check=True).stdout  # fmt: skip
    except Exception:  # noqa: BLE001
        return None
    for line in out.splitlines():
        idx, free = (x.strip() for x in line.split(","))
        if int(idx) == gpu:
            return float(free) / 1024
    return None


def disk_free_gb(path: Path) -> float:
    return shutil.disk_usage(path).free / 1e9


def check(ctx: Ctx) -> None:
    info = {"gpu": ctx.a.gpu, "gpu_free_gb": gpu_free_gb(ctx.a.gpu), "disk_free_gb": round(disk_free_gb(ctx.work), 1),
            "uv": shutil.which(ctx.a.uv.split()[0]) is not None, "git": shutil.which("git") is not None,
            "cases": sum(1 for _ in (ctx.work / "cases.jsonl").open(encoding="utf-8")),
            "pilot": sum(1 for _ in (ctx.work / "pilot.txt").open(encoding="utf-8"))}  # fmt: skip
    (ctx.work / "check.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    log(f"점검 {info}")
    if not ctx.a.python and (not info["uv"] or not info["git"]):
        raise RuntimeError("uv 또는 git이 없음")


def make_repo(ctx: Ctx, env: str) -> None:
    dest = ctx.work / "repos" / env
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    sh(ctx, ["git", "clone", "--depth", "1", REPOS[env], str(dest)], f"repo_{env}")
    if env == "kimi":  # 추론에 안 쓰는 학습용(deepspeed)과 따로 받는 flash_attn은 빼고 설치
        req = (dest / "requirements.txt").read_text(encoding="utf-8").splitlines()
        keep = [r for r in req if r.strip() and not r.startswith(("flash_attn", "deepspeed"))]
        (ctx.work / "kimi_requirements.txt").write_text("\n".join(keep) + "\n", encoding="utf-8")


def make_env(ctx: Ctx, env: str) -> None:
    pyver, steps = ENVS[env]
    path = ctx.work / "envs" / env
    if path.exists():
        shutil.rmtree(path)
    uv = ctx.a.uv.split()
    sh(ctx, [*uv, "venv", "--python", pyver, str(path)], f"env_{env}")
    repo = str(ctx.work / "repos" / env)
    for pkgs in steps:
        args = [p.format(repo=repo, work=str(ctx.work)) for p in pkgs]
        sh(ctx, [*uv, "pip", "install", "--python", ctx.py(env), *args], f"env_{env}")
    sh(
        ctx,
        [ctx.py(env), "-c", "import torch;print(torch.__version__, torch.cuda.is_available())"],
        f"env_{env}",
    )


def download(ctx: Ctx, model: str) -> None:
    env, repos = MODELS[model]
    for r in repos:
        sh(ctx, [ctx.py(env), "-c", f"from huggingface_hub import snapshot_download;print(snapshot_download('{r}'))"],
           f"download_{model}")  # fmt: skip


def ask(ctx: Ctx, model: str, audios: list[str], subset: Path | None) -> None:
    env, _ = MODELS[model]
    if not ctx.a.python and EXTRAS.get(env):
        sh(
            ctx,
            [*ctx.a.uv.split(), "pip", "install", "--python", ctx.py(env), *EXTRAS[env]],
            f"env_{env}",
        )
    cmd = [ctx.py(env), str(ctx.work / "scripts" / "cymrole_audio_llm.py"), "--backend", model,
           "--cases", str(ctx.work), "--audio", *audios, "--out", str(ctx.answers)]  # fmt: skip
    if subset is not None:
        cmd += ["--subset", str(subset)]
    if env in REPOS:
        cmd += ["--repo", str(ctx.work / "repos" / env)]
    sh(ctx, cmd, f"ask_{model}")


def score_pilot(ctx: Ctx, model: str) -> list[str]:
    """이 모델 작은 시험 답만 채점하고 통과한 오디오 목록을 돌려줌."""
    one = ctx.work / "pilot_answers" / model
    one.mkdir(parents=True, exist_ok=True)
    for a in AUDIOS:
        f = ctx.answers / f"answers_{model}_{a}.jsonl"
        if f.is_file():
            pilot = set((ctx.work / "pilot.txt").read_text(encoding="utf-8").split())
            rows = [
                x
                for x in f.read_text(encoding="utf-8").splitlines()
                if json.loads(x)["case_id"] in pilot
            ]
            (one / f.name).write_text("\n".join(rows) + "\n", encoding="utf-8")
    gate = ctx.work / "gate" / f"{model}.json"
    gate.parent.mkdir(parents=True, exist_ok=True)
    sh(ctx, [ctx.py("omni"), str(ctx.work / "scripts" / "cymrole_audio_eval.py"), "score", "--answers", str(one),
             "--truth", str(ctx.work / "truth.jsonl"), "--subset", str(ctx.work / "pilot.txt"),
             "--out", str(ctx.work / "pilot_scores" / f"{model}.csv"), "--gate", str(gate)], f"score_{model}")  # fmt: skip
    passed = json.loads(gate.read_text(encoding="utf-8"))
    return [n.removeprefix(f"{model}_") for n in passed]


def free_weights(ctx: Ctx, model: str) -> None:
    """디스크가 모자랄 때만 이 모델 가중치를 지움."""
    if disk_free_gb(ctx.work) >= ctx.a.min_disk_gb:
        return
    for r in MODELS[model][1]:
        d = ctx.work / "hf_cache" / "hub" / ("models--" + r.replace("/", "--"))
        if d.exists():
            shutil.rmtree(d)
            log(f"디스크 {disk_free_gb(ctx.work):.0f}GB 남아 {r} 가중치를 지움")


def run_model(ctx: Ctx, model: str) -> None:
    env, _ = MODELS[model]
    if not ctx.a.python:
        if env in REPOS and not stage(ctx, f"repo_{env}", lambda: make_repo(ctx, env)):
            return
        if not stage(ctx, f"env_{env}", lambda: make_env(ctx, env)):
            return
        if not stage(ctx, f"download_{model}", lambda: download(ctx, model)):
            return
    if not stage(
        ctx, f"pilot_{model}", lambda: ask(ctx, model, list(AUDIOS), ctx.work / "pilot.txt")
    ):
        return
    if not ctx.a.no_full:
        if not ctx.a.python and not (ctx.done / "env_omni").exists():  # 채점은 omni 환경의 numpy로
            stage(ctx, "env_omni", lambda: make_env(ctx, "omni"))
        holder: dict = {}
        if not stage(ctx, f"gate_{model}", lambda: holder.setdefault("p", score_pilot(ctx, model))):
            return
        passed = holder.get("p")
        if passed is None:
            g = ctx.work / "gate" / f"{model}.json"
            passed = [
                n.removeprefix(f"{model}_") for n in json.loads(g.read_text(encoding="utf-8"))
            ]
        log(f"{model} 작은 시험 통과 오디오: {passed or '없음'}")
        if passed and not stage(ctx, f"full_{model}", lambda: ask(ctx, model, passed, None)):
            return
    free_weights(ctx, model)


def pack(ctx: Ctx) -> None:
    out = Path(ctx.a.results).expanduser() / "cymrole_audio.zip"
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for sub in ("answers", "log", "gate", "pilot_scores", "failed", "done"):
            for p in sorted((ctx.work / sub).rglob("*")):
                if p.is_file():
                    z.write(p, f"cymrole_audio/{p.relative_to(ctx.work)}")
        if (ctx.work / "check.json").is_file():
            z.write(ctx.work / "check.json", "cymrole_audio/check.json")
    log(f"결과 zip {out} {out.stat().st_size / 1e6:.1f}MB")


def pid_alive(pid: int) -> bool:
    """그 번호의 프로세스가 이 파이프라인으로 실제로 돌고 있는지.

    11/10 서버: 끝난 파이프라인이 좀비(상태 Z)로 남아 os.kill(pid, 0)만으로는 '도는 중'으로 보였음.
    리눅스면 /proc에서 상태가 Z가 아니고 명령줄에 이 스크립트 이름이 있을 때만 도는 중으로 봄.
    """
    proc = Path(f"/proc/{pid}")
    if Path("/proc").is_dir():
        try:
            state = (proc / "stat").read_text().rsplit(")", 1)[1].split()[0]
            cmd = (proc / "cmdline").read_bytes()
        except OSError:
            return False
        return state != "Z" and b"cymrole_audio_pipeline" in cmd
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def status(work: Path) -> None:
    """진행 확인: 돌고 있는지, 단계별 끝·실패, 답 개수, 로그 끝."""
    pid_file = work / "pipeline.pid"
    alive = False
    if pid_file.is_file():
        pid = int(pid_file.read_text().strip())
        alive = pid_alive(pid)
        print(f"파이프라인 {'도는 중' if alive else '멈춤 또는 끝'} (pid {pid})")
    done = {p.name for p in (work / "done").glob("*")} if (work / "done").is_dir() else set()
    failed = {p.name: p.read_text(encoding="utf-8").strip() for p in (work / "failed").glob("*")}         if (work / "failed").is_dir() else {}  # fmt: skip
    for m in REAL_MODELS:
        env = MODELS[m][0]
        names = ([f"repo_{env}"] if env in REPOS else []) + [
            f"env_{env}",
            f"download_{m}",
            f"pilot_{m}",
            f"gate_{m}",
            f"full_{m}",
        ]
        marks = " ".join(
            f"{n.split('_')[0]}:{'끝' if n in done else '실패' if n in failed else '-'}"
            for n in names
        )
        print(f"  {m:11s} {marks}")
    for n, e in failed.items():
        print(f"  실패 {n}: {e[:200]}")
    ans = work / "answers"
    if ans.is_dir():
        for f in sorted(ans.glob("answers_*.jsonl")):
            print(
                f"  답 {f.stem.removeprefix('answers_')}: {sum(1 for _ in f.open(encoding='utf-8'))}마디"
            )
    gate_dir = work / "gate"
    if gate_dir.is_dir():
        for g in sorted(gate_dir.glob("*.json")):
            print(
                f"  작은 시험 통과 {g.stem}: {json.loads(g.read_text(encoding='utf-8')) or '없음'}"
            )
    logf = work / "pipeline.log"
    if logf.is_file():
        lines = logf.read_text(encoding="utf-8", errors="replace").splitlines()
        print("파이프라인 로그 끝:")
        for x in lines[-4:]:
            print("   ", x)
        cur = [x for x in lines if "시작 " in x]
        if alive and cur:
            name = cur[-1].split("시작 ", 1)[1].strip()
            sub = name.replace("pilot_", "ask_").replace("full_", "ask_").replace("gate_", "score_")
            lf = work / "log" / f"{sub}.log"
            if lf.is_file():
                tail = lf.read_text(encoding="utf-8", errors="replace").splitlines()[-3:]
                print(f"지금 단계 {name} 로그 끝:")
                for x in tail:
                    print("   ", x[:300])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--work", default="~/ssaplash/cymrole_audio")
    r.add_argument("--results", default="~/ssaplash/results")
    r.add_argument("--gpu", type=int, default=6)
    r.add_argument("--uv", default="uv", help="uv 실행 명령. 예: 'python -m uv'")
    r.add_argument("--models", nargs="+", default=REAL_MODELS, choices=list(MODELS))
    r.add_argument(
        "--min-disk-gb",
        type=float,
        default=150.0,
        help="이보다 적게 남으면 끝난 모델 가중치를 지움",
    )
    r.add_argument("--no-full", action="store_true", help="작은 시험까지만")
    r.add_argument(
        "--python",
        default=None,
        help="로컬 시험용. 가상환경·저장소·가중치 단계를 건너뛰고 이 파이썬으로 실행",
    )
    s = sub.add_parser("status")
    s.add_argument("--work", default="~/ssaplash/cymrole_audio")
    args = ap.parse_args()
    if args.cmd == "status":
        status(Path(args.work).expanduser().resolve())
        return 0
    ctx = Ctx(args)
    (ctx.work / "pipeline.pid").write_text(str(os.getpid()), encoding="utf-8")
    log(f"작업 폴더 {ctx.work}, GPU {ctx.a.gpu}, 모델 {ctx.a.models}")
    if not stage(ctx, "check", lambda: check(ctx)):
        return 1
    for m in ctx.a.models:
        run_model(ctx, m)
    pack(ctx)
    failed = sorted(p.name for p in ctx.failed.iterdir())
    log(f"전체 끝. 실패 단계: {failed or '없음'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
