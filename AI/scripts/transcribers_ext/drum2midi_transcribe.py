"""drum2midi 채보 스크립트 (별도 환경 `.venv-drum2midi`).

drum2midi(github.com/miraer/drum2midi, MIT)는 ADTOF + MDX23C 드럼 분리 + 탐·하이햇·심벌 규칙을 묶은 프로그램.
우리 adtof_drumsep 어댑터가 참고한 원본을 그대로 돌려 같은 채점으로 비교하려는 것.
options.repo_dir(저장소 클론 경로, 기본 ext/drum2midi)의 drum2midi.py를 곡마다 이 환경의 python으로 부름.
drum2midi는 곡마다 분리 모델을 새로 띄우므로 채보 시간에 모델 로드가 섞임(RTF는 참고용).
options.args(문자열 목록)는 drum2midi 명령 옵션 그대로 붙음. 기본은 세기·페달 학습 모델(pickle)을 안 쓰는 --no-learned.
출력 MIDI(GM 피치, 세기)를 읽어 [시각, 피치, 세기]로 돌려줌. 라벨 → 패드 대응은 하네스 yaml.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _protocol import midi_hits, run  # noqa: E402

DEFAULT_ARGS = ["--no-learned"]
STDERR_TAIL = 1500


def load(options: dict, device: str):
    repo_dir = Path(options.get("repo_dir") or "ext/drum2midi").resolve()
    script = repo_dir / "drum2midi.py"
    if not script.is_file():
        raise FileNotFoundError(
            f"drum2midi 저장소가 없음: {repo_dir} (git clone https://github.com/miraer/drum2midi)"
        )
    head = repo_dir / ".git" / "HEAD"
    commit = ""
    if head.is_file():
        ref = head.read_text(encoding="utf-8").strip()
        ref_file = repo_dir / ".git" / ref[5:] if ref.startswith("ref: ") else None
        commit = (
            ref_file.read_text(encoding="utf-8").strip() if ref_file and ref_file.is_file() else ref
        )
    return script, f"drum2midi@{commit[:7] or 'unknown'}", None


def transcribe(handle, wav_path: str, device: str, options: dict) -> list:
    script = handle
    dev = "cuda" if device.startswith("cuda") else "cpu"
    extra = options.get("args")
    extra = DEFAULT_ARGS if extra is None else [str(a) for a in extra]
    with tempfile.TemporaryDirectory() as tmp:
        midi_path = Path(tmp) / "out.mid"
        cmd = [sys.executable, str(script), wav_path, "-o", str(midi_path), "--device", dev, *extra]
        # drum2midi는 저장소 폴더 기준으로 모델·ADTOF-pytorch를 찾으므로 그 폴더에서 실행
        proc = subprocess.run(
            cmd,
            cwd=str(script.parent),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if proc.returncode != 0 or not midi_path.is_file():
            text = (proc.stderr or proc.stdout or "").strip()
            # 하네스가 오류를 앞 300자만 남기므로 예외 이름이 있는 마지막 줄을 맨 앞에 둠
            last = text.splitlines()[-1] if text else ""
            raise RuntimeError(
                f"drum2midi 실패 (exit {proc.returncode}): {last} | {text[-STDERR_TAIL:]}"
            )
        return midi_hits(midi_path)


if __name__ == "__main__":
    sys.exit(run(load, transcribe))
