"""Omnizart drum 채보 스크립트 (별도 환경 `.venv-omnizart`, TensorFlow).

`pip install omnizart` + `omnizart download-checkpoints` 뒤에 씀. 저장소의 공개 추론(`inference`)은
13분류 예측 중 킥(35)·스네어(38)·하이햇(42) 셋만 MIDI로 냄(2026-10-21 코드 확인). 그래서 라벨은 이 셋뿐이고
탐·심벌은 못 냄. 모델을 한 번만 올리려고 DrumTranscription 내부 함수(_load_model·predict·inference)를
직접 부르고, 그게 안 되면 공개 transcribe()로 곡마다 돌림(그때는 로드 시간이 채보 시간에 섞이며 note에 적음).
특징 추출 함수 extract_patch_cqt는 0.6.x에서 omnizart.feature.wrapper_func, 옛 판에서는 omnizart.feature.cqt에 있음.
GPU 메모리는 TensorFlow라 torch 값이 없으므로 null → 러너가 nvidia-smi 값을 씀.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _protocol import midi_hits, run  # noqa: E402

_NOTE = None


def _internal_funcs():
    """내부 API 세 함수. 버전마다 자리가 달라 여기서 한 번에 찾음. 없으면 ImportError."""
    from omnizart.drum.inference import inference
    from omnizart.drum.prediction import predict

    try:
        from omnizart.feature.wrapper_func import extract_patch_cqt
    except ImportError:
        from omnizart.feature.cqt import extract_patch_cqt
    return extract_patch_cqt, predict, inference


def load(options: dict, device: str):
    global _NOTE
    import os

    if not device.startswith("cuda"):
        os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
    from omnizart.drum.app import DrumTranscription

    app = DrumTranscription()
    model_path = options.get("checkpoint_path")
    checkpoint = str(model_path or "omnizart-drum-default")
    try:
        funcs = _internal_funcs()
        model, settings = app._load_model(model_path, custom_objects=app.custom_objects)
        handle = ("internal", app, model, settings, funcs)
    except Exception as exc:  # 내부 API가 바뀌면 공개 API로
        _NOTE = f"내부 API 실패({type(exc).__name__}: {exc}), 공개 transcribe()로 곡마다 로드 (RTF에 로드 포함)"
        handle = ("public", app, None, None, None)
    return handle, checkpoint, None


def transcribe(handle, wav_path: str, device: str, options: dict) -> list:
    mode, app, model, settings, funcs = handle
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "out.mid"
        if mode == "internal":
            extract_patch_cqt, predict, inference = funcs
            feat, beats = extract_patch_cqt(wav_path)
            pred = predict(feat, model, settings.feature.mini_beat_per_segment)
            midi = inference(
                pred,
                beats,
                bass_drum_th=settings.inference.bass_drum_th,
                snare_th=settings.inference.snare_th,
                hihat_th=settings.inference.hihat_th,
            )
        else:
            midi = app.transcribe(wav_path, model_path=options.get("checkpoint_path"), output=d)
        midi.write(str(out))
        return midi_hits(out)


if __name__ == "__main__":
    sys.exit(run(load, transcribe, note=lambda: _NOTE))
