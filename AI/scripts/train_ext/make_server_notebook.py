"""STRUM CRNN 실제 곡 학습용 서버 노트북을 만듦 (11/11).

`notebooks/ext_models_finetune_server.ipynb`는 셀 두 개(시작, 진행 확인)이고, 시작 셀 안에 실행할 스크립트
(scripts/train_ext의 파일들)와 올린 zip의 md5를 글자 그대로 담음. 스크립트를 고치면 이 스크립트를 다시 돌려 노트북을 새로 만듦.
md5는 `pack_server_data.py`·`pack_server_models.py`가 `data/upload/ext_ft/`에 남긴 값을 읽음.

  uv run python scripts/train_ext/make_server_notebook.py
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
AI = HERE.parent.parent
FILES = (
    "_common.py",
    "_loop.py",
    "strum_crnn.py",
    "export_manifest.py",
    "ext_ft_pipeline.py",
)
UPLOAD = AI / "data" / "upload" / "ext_ft"
NOTEBOOK = AI / "notebooks" / "ext_models_finetune_server.ipynb"

INTRO = """# STRUM 채보 모델 실제 곡 학습 — GPU 서버 실행

STRUM의 8종 온셋 CRNN을 실제 발매곡 457곡으로 이어서 학습하고, 검증·시험 곡 채보 결과를 묶어 낸다.

- 학습은 두 개이고 동시에 돈다. `strum_p3_R`은 실제 곡 457곡만, `strum_p3_RE`는 실제 곡 + 서버에 있는 E-GMD 어쿠스틱 킷(구간의 30%)
- 결과: `~/ssaplash/results/ext_ft_results.zip` (학습 기록·로그·검증과 시험 곡 채보 결과). 가중치는 `~/ssaplash/ext_ft/runs/`에 남는다

**준비물.** JupyterHub `ssaplash/upload/`에 `ext_ft_data_01.zip` ~ `ext_ft_data_08.zip`과 `ext_ft_models.zip`을 올리고, 이 파일을 `ssaplash/notebooks/`에 올린다. 서버 `~/ssaplash/S15P31A307`은 운영 워커 코드라 덮어쓰지 않고 그 `.venv`를 실행만 한다.

**실행.** 1번 셀을 한 번 실행하면 파일 확인 → 풀기 → E-GMD 목록 → 학습 2개 → 채보 → 결과 묶기가 백그라운드로 끝까지 돈다. 브라우저를 닫아도 계속 돈다. 진행은 2번 셀로 아무 때나 본다.

**끊기면.** 서버가 다시 시작됐거나 2번 셀에 '멈춤'이 나오면 1번 셀을 다시 실행한다. 끝난 단계는 건너뛰고 학습은 마지막 저장에서 이어 간다. 이미 돌고 있을 때 1번을 다시 치면 새로 시작하지 않는다.
"""

START_HEAD = """# 1. 시작 (여러 번 실행해도 됨). 처음이면 전체 과정을 백그라운드로 시작함
#    이미 돌고 있으면 새로 시작하지 않고, 멈춰 있으면 끝난 단계는 건너뛰고 이어 감
import os
import subprocess
import sys
from pathlib import Path

GPU_ID = "6"                                # 지정받은 GPU
RUNS = ""  # 비우면 학습 2개 전부. 하나만 돌릴 때는 "strum_p3_RE"처럼
HOME = Path.home()
WORK = HOME / "ssaplash"
AI = WORK / "S15P31A307" / "AI"             # 운영 워커 코드. .venv를 실행만 함
VPY = AI / ".venv" / "bin" / "python"
EXT = WORK / "ext_ft"  # 이 작업 폴더 (풀어 둔 데이터·학습·결과)
FILES = EXT / "files"

# 실행할 스크립트와 올린 zip의 md5. 저장소 AI/scripts/train_ext의 같은 이름 파일과 내용이 같음
FILES_TEXT = {
"""

START_TAIL = '''}


def running_pid():
    """돌고 있는 파이프라인 pid. 없으면 None."""
    pid_file = EXT / "launcher.pid"
    if not pid_file.is_file():
        return None
    pid = pid_file.read_text().strip()
    try:
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return None
    return pid if b"ext_ft_pipeline" in cmdline else None


pid = running_pid()
if pid:
    print("이미 도는 중. pid", pid, "→ 2번 셀로 진행을 확인함")
else:
    for name, text in FILES_TEXT.items():
        path = FILES / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text.lstrip("\\n"), encoding="utf-8")
    env = dict(os.environ, CUDA_VISIBLE_DEVICES=GPU_ID, PYTHONUTF8="1", PYTHONUNBUFFERED="1")
    env.pop("PYTHONPATH", None)
    cmd = [
        str(VPY), str(FILES / "ext_ft_pipeline.py"), "run",
        "--work", str(EXT), "--upload", str(WORK / "upload"), "--ai", str(AI), "--vpy", str(VPY),
        "--egmd-root", str(WORK / "datasets" / "e-gmd" / "e-gmd-v1.0.0"),
        "--results", str(WORK / "results"), "--runs", RUNS, "--zip-name", "ext_ft_results",
        "--uv", f"{sys.executable} -m uv",       # 없는 패키지를 받을 때만 씀
    ]
    proc = subprocess.Popen(["nohup", "nice", "-n", "10", *cmd], cwd=EXT, env=env,
                            stdout=open(EXT / "pipeline.log", "a"), stderr=subprocess.STDOUT,
                            start_new_session=True)
    (EXT / "launcher.pid").write_text(str(proc.pid))
    print("시작. pid", proc.pid, "로그", EXT / "pipeline.log")
# 확인: 처음엔 '시작. pid 숫자 로그 /home/.../ssaplash/ext_ft/pipeline.log'.
#       다시 치면 '이미 도는 중. pid 숫자'. 1분쯤 뒤 2번 셀에서 check가 [끝]이 되는지 봄
'''

STATUS = """# 2. 진행 확인 (여러 번 쳐도 됨. 커널이 다시 시작돼도 이 셀만 바로 쳐도 됨)
from pathlib import Path

EXT = Path.home() / "ssaplash" / "ext_ft"
VPY = Path.home() / "ssaplash" / "S15P31A307" / "AI" / ".venv" / "bin" / "python"
!{VPY} {EXT}/files/ext_ft_pipeline.py status --work {EXT}
!nvidia-smi -i 6 --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader
!ls -la ~/ssaplash/results/ext_ft_results.zip 2>/dev/null || echo "결과 zip 아직 없음"
# 확인 (학습 중 예):
#   파이프라인 도는 중 (pid 12345, 시작 2026-11-11 15:00:00)
#   지금 단계: train (시작 2026-11-11 15:20:00)
#     [끝] check {'models': ['strum'], 'skipped': {}, 'minutes': 0.2}
#     [끝] data {'songs': {'train457': 457, 'val10': 10, ...}, 'minutes': 6.0}
#     [끝] egmd {'ok': True, 'songs': 2만 안팎, 'minutes': 10.0}
#     [ ] train   [ ] dump   [ ] pack
#     strum_p3_R: 학습 전 0.739 → 최고 0.85x (스텝 1500), 마지막 검증 스텝 2000 | [train] 스텝 2100/8000 손실 ...
#     (학습 2개가 한 줄씩)
# - 단계가 모두 [끝]이고 zip 크기가 보이면 끝. ~/ssaplash/results/ext_ft_results.zip을 내려받음
# - '멈춤'이 보이면 아래 '파이프라인 로그 끝' 줄을 적어 두고 1번 셀을 다시 실행. 같은 오류로 또 멈추면 그 줄을 알려 줌
# - egmd가 {'ok': False}면 strum_p3_RE는 빠지고 strum_p3_R만 돎
"""


def cell(kind: str, text: str) -> dict:
    lines = text.splitlines(keepends=True)
    if kind == "markdown":
        return {"cell_type": "markdown", "metadata": {}, "source": lines}
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": lines,
    }


NL = chr(10)


def main() -> int:
    md5 = json.loads((UPLOAD / "md5.json").read_text(encoding="utf-8"))
    md5.update(json.loads((UPLOAD / "md5_models.json").read_text(encoding="utf-8")))
    texts = {name: (HERE / name).read_text(encoding="utf-8") for name in FILES}
    name = "egmd_train_acoustic.yaml"
    texts[name] = (AI / "configs" / "bench" / "datasets" / name).read_text(encoding="utf-8")
    texts["md5.json"] = json.dumps(md5, indent=1)
    parts = [START_HEAD]
    for name, text in texts.items():
        if "'''" in text:
            raise SystemExit(f"{name}에 ''' 가 있어 노트북에 담을 수 없음")
        if text.rstrip(NL).endswith(chr(92)):
            raise SystemExit(f"{name}이 역슬래시로 끝남")
        parts.append(f"    \"{name}\": r'''{NL}{text.rstrip(NL)}''',{NL}")
    parts.append(START_TAIL)
    nb = {
        "cells": [
            cell("markdown", INTRO),
            cell("code", "".join(parts)),
            cell("code", STATUS),
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    NOTEBOOK.write_bytes((json.dumps(nb, ensure_ascii=False, indent=1) + NL).encode("utf-8"))
    print(
        f"[notebook] {NOTEBOOK} ({NOTEBOOK.stat().st_size / 1024:.0f}KB, "
        f"파일 {len(texts)}개, zip {len(md5)}개)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
