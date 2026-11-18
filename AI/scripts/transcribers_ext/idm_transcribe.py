"""Inverse Drum Machine 채보 스크립트 (별도 환경 `.venv-idm`).

저장소(options.repo_dir, 기본 ext/inverse-drum-machine)를 sys.path에 넣고 idm 패키지를 import.
가중치는 저장소 pretrained/idm-44-train-kits/checkpoints/*.ckpt(2.5MB, 저장소에 포함).
흐름: 모노 44.1kHz 파형(최댓값 정규화) → model.encoder → activations["onset"] 로짓 → sigmoid →
저장소의 pickpeaks(기본값)로 분류별 온셋 시각(초). PeakPicking 클래스는 sampling_rate 미설정 버그가 있어 안 씀.
라벨은 model.train_classes 이름(KD, SD, HH_CHH, HH_OHH, TT_HFT, TT_HMT, TT_LMT, CY_CR, CY_RD). 세기 없음.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _protocol import run  # noqa: E402


def load(options: dict, device: str):
    repo_dir = Path(options.get("repo_dir") or "ext/inverse-drum-machine").resolve()
    if not (repo_dir / "idm").is_dir():
        raise FileNotFoundError(
            f"Inverse Drum Machine 저장소가 없음: {repo_dir} (git clone https://github.com/bernardo-torres/inverse-drum-machine)"
        )
    sys.path.insert(0, str(repo_dir))
    import torch
    from idm.inference import load_model

    dev = torch.device(
        device if (device.startswith("cuda") and torch.cuda.is_available()) else "cpu"
    )
    identifier = options.get("variant") or "idm-44-train-kits"
    log_dir = str(options.get("checkpoint_path") or (repo_dir / "pretrained"))
    model, name = load_model(identifier, dev, log_dir=log_dir)
    model.eval()
    n_params = sum(p.numel() for p in model.parameters()) if hasattr(model, "parameters") else None
    return (model, dev), str(name), n_params


def transcribe(handle, wav_path: str, device: str, options: dict) -> list:
    import librosa
    import soundfile as sf
    import torch
    from idm.synthesis_conditioning.peak_picking import pickpeaks

    model, dev = handle
    audio, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    target_sr = int(getattr(model, "sampling_rate", 44100))
    if sr != target_sr:
        mono = librosa.resample(mono, orig_sr=sr, target_sr=target_sr)
    mono = mono / max(float(abs(mono).max()), 1e-8)  # 저장소 demo의 maxabs 정규화
    x = torch.from_numpy(mono.astype("float32")).to(dev)[None, :]
    with torch.no_grad():
        encoder_outs = model.encoder(x)
    onset = encoder_outs["activations"]["onset"]  # (배치, 분류, 프레임)
    rate = float(encoder_outs["activation_rate"])
    classes = list(model.train_classes)
    # 저장소 PeakPicking.forward는 self.sampling_rate 미설정 버그가 있어 안쪽 함수 pickpeaks를 직접 씀.
    # 기본값(div_max 20·div_avg 10·div_wait 16·div_thre 5)은 그대로. 결과는 분류별 온셋 시각(초)
    # 디코더(decoder.py)와 같이 로짓에 sigmoid를 건 뒤 봉우리를 찾음
    picked = pickpeaks(torch.sigmoid(onset).detach().cpu().numpy(), sampling_rate=rate)[0]
    hits = []
    for ci, name in enumerate(classes):
        hits.extend([[float(t), name, None] for t in picked[ci]])
    return sorted(hits, key=lambda h: h[0])


if __name__ == "__main__":
    sys.exit(run(load, transcribe))
