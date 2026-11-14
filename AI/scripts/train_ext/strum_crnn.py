"""STRUM의 8종 온셋 CRNN 한 개만 써서 채보하고 실제 곡으로 이어서 학습 (별도 환경 `.venv-strum`, 11/11).

STRUM 전체 파이프라인(온셋 검출 → 분류기 6개 → 드럼 킷 분리 아비터 → 후처리)은 곡 길이의 0.2 ~ 0.5배가 걸리고
이어서 학습하기 어려움. 저장소의 `checkpoints/drums_phase3/best.pt`는 8종 온셋을 프레임별로 바로 내는
CRNN임(42M, MIT). 출력 mc_onset_probs

dump: 곡 목록의 곡마다 프레임별 8종 온셋 점수를 `data/ext_train/acts/<태그>/<목록>/<곡>.npz`로 저장. 점수 종류 이름은 p3
train: 임의 구간(--seconds)으로 8종 온셋 머리까지 전체를 이어서 학습. 손실은 저장소와 같은 focal BCE.
  --eval-every 스텝마다 검증 곡을 채보해 8패드 F1(분류별 문턱값은 검증 곡에서 고름)을 찍고 가장 높은 가중치를 best.pt로 둠

  .venv-strum/Scripts/python.exe -I scripts/train_ext/strum_crnn.py dump --tag strum_p3 --manifest data/ext_train/val10.json
  .venv-strum/Scripts/python.exe -I scripts/train_ext/strum_crnn.py train --train data/ext_train/train457.json --val data/ext_train/val10.json --out data/models/ext_ft/strum_p3_real
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import _loop  # noqa: E402
import numpy as np  # noqa: E402
from _common import PADS  # noqa: E402

SR, N_FFT, HOP, N_MELS = 44100, 2048, 512, 128
FPS = SR / HOP
# STRUM 분류 순서(Kick, Snare, HiHat, HighTom, Ride, LowTom, Crash, FloorTom) → 우리 패드 이름
NAMES = ["KICK", "SNARE", "HIHAT", "SMALL_TOM", "RIDE", "MID_TOM", "CRASH", "FLOOR_TOM"]
PAD_TO_CLASS = {PADS.index(n): i for i, n in enumerate(NAMES)}
POS_WEIGHT = [3, 4, 5, 10, 8, 10, 8, 10]  # phase3 체크포인트 config의 onset_class_pos_weights


WEIGHTS = "data/models/strum/drums/drums_phase3/best.pt"


def load_module(model_py: Path):
    """저장소 `src/models/drums_v13.py` 한 파일만 불러옴(torch만 필요). 저장소의 다른 코드는 안 씀."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("strum_drums_v13", model_py)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_model(module, weights: Path, device, checkpoint: str | None = None):
    """저장소 batch_infer_hybrid.py의 load_phase3_model과 같은 방식으로 모델을 만듦."""
    import torch

    # 공개 가중치 파일에는 텐서와 numpy 스칼라·dtype만 들어 있음. 그 밖의 객체가 든 파일은 읽지 않음
    core = getattr(np, "_core", None) or np.core  # numpy 1.x에는 _core가 없음
    safe = [np.dtype, core.multiarray.scalar]
    safe += [type(np.dtype(t)) for t in ("float64", "float32", "int64", "int32", "bool")]
    torch.serialization.add_safe_globals(safe)
    ckpt = torch.load(weights, map_location="cpu", weights_only=True)
    cfg = (ckpt.get("config") or {}).get("model", {})
    model = module.TwoStageDrumsCRNN(
        n_mels=cfg.get("n_mels", 128),
        conv_channels=cfg.get("conv_channels", [64, 128, 256, 512]),
        freq_subbands=cfg.get("freq_subbands", [32, 64, 96, 128]),
        subband_proj_dim=cfg.get("subband_proj_dim", 256),
        lstm_hidden=cfg.get("lstm_hidden", 640),
        lstm_layers=cfg.get("lstm_layers", 3),
        attention_heads=cfg.get("attention_heads", 10),
        attention_type=cfg.get("attention_type", "flash"),
        attention_window=cfg.get("attention_window", 512),
        dropout=0.0,
        onset_detector_hidden=cfg.get("onset_detector_hidden", 320),
        classifier_hidden=cfg.get("classifier_hidden", 640),
        num_classes=cfg.get("num_classes", 8),
        predict_velocity=cfg.get("predict_velocity", False),
    )
    model.add_multiclass_onset_head()
    missing, unexpected = model.load_state_dict(ckpt["model_state_dict"], strict=False)
    if missing or unexpected:
        raise RuntimeError(f"STRUM 가중치와 층 이름이 안 맞음: 없음 {missing} 남음 {unexpected}")
    name = "opria123/strum phase3"
    if checkpoint:
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        model.load_state_dict(state["model_state_dict"], strict=True)
        name = str(checkpoint)
    return model.to(device), name


class Mel:
    def __init__(self, device):
        import torchaudio

        self.t = torchaudio.transforms.MelSpectrogram(
            sample_rate=SR, n_fft=N_FFT, hop_length=HOP, n_mels=N_MELS
        ).to(device)

    def __call__(self, audio):
        """(배치, 샘플) → (배치, 1, 멜, 프레임) 로그 멜. 저장소 bg_mel(배경 빼기 꺼짐)과 같은 계산."""
        import torch

        return torch.log(self.t(audio) + 1e-8).unsqueeze(1)


def infer(model, mel: Mel, audio: np.ndarray, device, batch: int = 8) -> dict:
    """곡 하나 → 프레임별 8종 온셋 점수 {"p3": (프레임, 8)}. 저장소 추론과 같이 10초 구간을 절반씩 겹쳐 평균."""
    import torch

    with torch.no_grad():
        spec = mel(torch.from_numpy(audio).to(device)[None])[0]  # (1, 멜, 프레임)
        total = spec.shape[-1]
        seg = int(10.0 * SR / HOP)
        hop = seg // 2
        starts = list(range(0, max(total - seg, 0) + 1, hop)) or [0]
        if starts[-1] + seg < total:
            starts.append(starts[-1] + hop)
        mc = torch.zeros(total, 8, device=device)
        count = torch.zeros(total, 1, device=device)
        for i in range(0, len(starts), batch):
            chunk = starts[i : i + batch]
            parts = [spec[:, :, s : s + seg] for s in chunk]
            x = torch.stack([torch.nn.functional.pad(p, (0, seg - p.shape[-1])) for p in parts])
            out = model(x)
            for k, s in enumerate(chunk):
                n = min(seg, total - s)
                mc[s : s + n] += out["mc_onset_probs"][k, :n]
                count[s : s + n] += 1
        count = count.clamp(min=1)
    return {"p3": (mc / count).cpu().numpy()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for cmd in ("dump", "train"):
        p = sub.add_parser(cmd)
        p.add_argument("--model-py", default="ext/strum/src/models/drums_v13.py")
        p.add_argument("--weights", default=WEIGHTS, help="공개 가중치 파일")
    _loop.add_common_args(sub, default_seconds=20.0, default_lr=3e-5, default_batch=4)
    t = sub.choices["train"]
    t.add_argument("--dropout", type=float, default=0.3)
    t.add_argument("--spec-augment", action="store_true")
    t.add_argument("--init", default=None, help="이 가중치에서 시작(다른 학습의 best.pt)")
    args = ap.parse_args()
    _loop.resolve_paths(args)

    import torch

    module = load_module(Path(args.model_py).resolve())
    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    start = args.checkpoint if args.cmd == "dump" else args.init
    model, name = load_model(module, Path(args.weights).resolve(), device, start)
    mel = Mel(device)

    if args.cmd == "dump":
        model.eval()
        _loop.dump(
            lambda audio: infer(model, mel, audio, device),
            args.manifest,
            args.acts,
            args.tag,
            NAMES,
            FPS,
            name,
        )
        return 0

    for m in model.modules():
        if isinstance(m, torch.nn.Dropout):
            m.p = args.dropout
    model.lstm.dropout = args.dropout
    freq_mask = time_mask = None
    if args.spec_augment:
        import torchaudio

        freq_mask = torchaudio.transforms.FrequencyMasking(27)
        time_mask = torchaudio.transforms.TimeMasking(50)

    def logits_of(audio):
        with torch.no_grad():
            x = mel(audio)
            if freq_mask is not None:
                low = float(x.min())
                x = time_mask(freq_mask(x, mask_value=low), mask_value=low)
        return model(x)

    return _loop.train(
        args,
        model,
        lambda audio: logits_of(audio)["mc_onset_logits"],
        lambda audio: infer(model, mel, audio, device)["p3"],
        NAMES,
        HOP,
        FPS,
        PAD_TO_CLASS,
        POS_WEIGHT,
        floor=True,
    )


if __name__ == "__main__":
    raise SystemExit(main())
