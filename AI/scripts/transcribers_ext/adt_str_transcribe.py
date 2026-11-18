"""ADT_STR 채보 스크립트 (별도 환경 `.venv-adt-str`).

ADT_STR은 패키지가 아니라 저장소를 받아 그 안에서 실행해야 하고 torch 2.8을 고정함.
options.repo_dir(저장소 클론 경로, 기본 ext/ADT_STR)를 sys.path에 넣고 adt_transcriber를 import.
가중치는 HF `Pierfrancesco/adt-str`의 variant 폴더(setting-tau-0.8 등)에서 snapshot_download.
입력 wav(44.1kHz 스테레오)는 ADTTranscriber가 모노·24kHz로 바꾸고 2.56초 조각으로 돌림.
출력 MIDI(GM 피치, 세기)를 읽어 [시각, 피치, 세기]로 돌려줌. 라벨 → 패드 대응은 하네스 yaml.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _protocol import midi_hits, run  # noqa: E402

DEFAULT_REPO = "Pierfrancesco/adt-str"


def load(options: dict, device: str):
    repo_dir = Path(options.get("repo_dir") or "ext/ADT_STR").resolve()
    if not (repo_dir / "adt_transcriber.py").is_file():
        raise FileNotFoundError(
            f"ADT_STR 저장소가 없음: {repo_dir} (git clone https://github.com/pier-maker92/ADT_STR)"
        )
    sys.path.insert(0, str(repo_dir))
    import torch
    from adt_transcriber import ADTTranscriber

    variant = options.get("variant") or "setting-tau-0.8"
    repo_id = options.get("checkpoint_path") or options.get("hf_repo") or DEFAULT_REPO
    dev = device if (device.startswith("cuda") and torch.cuda.is_available()) else "cpu"
    transcriber = ADTTranscriber.from_pretrained(repo_id, variant=variant, device=dev)
    n_params = None
    model = getattr(transcriber, "model", None)
    if model is not None and hasattr(model, "parameters"):
        n_params = sum(p.numel() for p in model.parameters())
    return transcriber, f"{repo_id}/{variant}", n_params


def transcribe(handle, wav_path: str, device: str, options: dict) -> list:
    import soundfile as sf
    import torch

    audio, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    waveform = torch.from_numpy(audio.mean(axis=1))
    with tempfile.TemporaryDirectory() as d:
        midi_path = handle.transcribe(waveform, output_dir=d, sample_rate=sr)
        if isinstance(midi_path, list):
            midi_path = midi_path[0]
        return midi_hits(midi_path)


if __name__ == "__main__":
    sys.exit(run(load, transcribe))
