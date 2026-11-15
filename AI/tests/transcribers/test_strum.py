"""STRUM CRNN 어댑터와 규칙 계산 테스트.

규칙 계산(strum_rules)은 numpy·scipy만으로 돎. 모델을 올리는 테스트는 torch·torchaudio가 없으면 건너뜀.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from ssaplash_ai.bench.transcribers import ADAPTERS, TranscriberConfig, create_transcriber
from ssaplash_ai.bench.transcribers.strum_rules import (
    PADS,
    Peaks,
    acts_to_hits,
    apply_kick_gain,
    pick_peaks,
    rules_with_defaults,
    to_hits,
)
from ssaplash_ai.bench.transcribers.strum_transcriber import (
    STRUM_CLASS_PADS,
    StrumCrnnTranscriber,
    file_sha256,
    segment_starts,
)

ROOT = Path(__file__).resolve().parents[2]
MODEL_YAML = ROOT / "configs/bench/transcribers/strum/strum_crnn_songsterr_egmd.yaml"
FPS = 44100 / 512
THRESHOLDS = {p: 0.6 for p in PADS}
KICK_GAIN = {
    "target": 0.8,
    "percentile": 90.0,
    "floor": 0.2,
    "min_peaks": 3,
    "max_gain": 2.5,
    "near_ms": 30.0,
}
# 모델 테스트용 작은 구조. 가중치는 무작위
SMALL_MODEL = {
    "conv_channels": [4, 8, 8, 8],
    "subband_proj_dim": 8,
    "lstm_hidden": 8,
    "lstm_layers": 1,
    "attention_heads": 2,
    "attention_window": 16,
    "onset_detector_hidden": 8,
    "classifier_hidden": 8,
}


def _peaks(rows: list[tuple[int, str, int]]) -> Peaks:
    rows = sorted(rows, key=lambda r: r[0])
    return Peaks(
        frame=np.array([r[0] for r in rows], dtype=np.int64),
        pad=np.array([r[1] for r in rows], dtype="U16"),
        score=np.array([r[2] for r in rows], dtype=np.int64),
    )


def _acts(peaks: dict[str, list[tuple[int, float]]], n_frames: int = 400) -> np.ndarray:
    """패드별 (프레임, 점수) 위치에만 값이 있는 프레임별 점수. 열 순서는 STRUM_CLASS_PADS."""
    acts = np.zeros((n_frames, len(STRUM_CLASS_PADS)), dtype=np.float32)
    for pad, items in peaks.items():
        for frame, score in items:
            acts[frame, STRUM_CLASS_PADS.index(pad)] = score
    return acts


# ---- 피크 찾기 ----


def test_피크는_floor_이상만_남고_점수는_1000배_정수():
    acts = _acts({"KICK": [(10, 0.75), (50, 0.05)], "SNARE": [(30, 0.1234)]})
    peaks = pick_peaks(acts, STRUM_CLASS_PADS, FPS, floor=0.1, gap_ms=30)
    assert peaks.frame.tolist() == [10, 30]
    assert peaks.pad.tolist() == ["KICK", "SNARE"]
    assert peaks.score.tolist() == [750, 123]


def test_같은_패드_피크는_최소_간격_안에서_높은_것만():
    # 30ms는 3프레임. 2프레임 떨어진 두 피크는 높은 쪽만, 4프레임 떨어진 것은 둘 다
    acts = _acts({"HIHAT": [(10, 0.5), (12, 0.9), (16, 0.7)]})
    peaks = pick_peaks(acts, STRUM_CLASS_PADS, FPS, floor=0.1, gap_ms=30)
    assert peaks.frame.tolist() == [12, 16]


# ---- 킥 규칙 ----


def test_킥이_탐보다_많은_곡은_킥_규칙_대상이_아님():
    peaks = _peaks([(i * 10, "KICK", 700) for i in range(5)] + [(7, "FLOOR_TOM", 900)])
    out, result = apply_kick_gain(peaks, FPS, THRESHOLDS, KICK_GAIN)
    assert not result.applied and result.gain == 1.0
    assert (result.n_kick, result.n_tom) == (5, 1)
    assert out.score.tolist() == peaks.score.tolist()


def test_탐이_더_많고_킥_점수가_낮으면_킥을_키우고_겹친_탐을_지움():
    kicks = [(100, "KICK", 400), (200, "KICK", 400), (300, "KICK", 400), (400, "KICK", 200)]
    toms = [
        (101, "FLOOR_TOM", 900),  # 킥 100에서 1프레임(11.6ms): 지움
        (202, "MID_TOM", 800),  # 킥 200에서 2프레임(23.2ms): 지움
        (303, "SMALL_TOM", 700),  # 킥 300에서 3프레임(34.8ms): 남음
        (401, "FLOOR_TOM", 650),  # 킥 400은 키워도 문턱값 미만이라 남음
    ]
    out, result = apply_kick_gain(_peaks(kicks + toms), FPS, THRESHOLDS, KICK_GAIN)
    # 킥 4개(200 이상)의 90 백분위는 400, 배율 800 / 400 = 2
    assert result.applied and result.gain == pytest.approx(2.0)
    assert (result.n_kick, result.n_tom, result.n_tom_dropped) == (0, 4, 2)
    score = dict(
        zip(zip(out.frame.tolist(), out.pad.tolist(), strict=True), out.score.tolist(), strict=True)
    )
    assert [score[(f, "KICK")] for f in (100, 200, 300, 400)] == [800, 800, 800, 400]
    assert score[(101, "FLOOR_TOM")] == 0 and score[(202, "MID_TOM")] == 0
    assert score[(303, "SMALL_TOM")] == 700 and score[(401, "FLOOR_TOM")] == 650


def test_킥_배율은_max_gain과_점수_1000에서_잘림():
    kicks = [(100 * i, "KICK", 300 if i < 5 else 900) for i in range(1, 6)]
    toms = [(100 * i + 50, "MID_TOM", 900) for i in range(1, 7)]
    out, result = apply_kick_gain(_peaks(kicks + toms), FPS, THRESHOLDS, KICK_GAIN)
    # 킥 300 네 개와 900 한 개의 90 백분위는 660, 배율 800 / 660. 900 × 배율은 1000을 넘어 1000으로 잘림
    assert result.gain == pytest.approx(800 / 660)
    assert out.score[out.pad == "KICK"].tolist() == [364, 364, 364, 364, 1000]
    limited = {**KICK_GAIN, "max_gain": 1.1}
    _, capped = apply_kick_gain(_peaks(kicks + toms), FPS, THRESHOLDS, limited)
    assert capped.gain == pytest.approx(1.1)


def test_킥_피크가_min_peaks보다_적거나_규칙이_없으면_그대로():
    peaks = _peaks(
        [(100, "KICK", 300), (200, "KICK", 300)] + [(50 * i, "MID_TOM", 900) for i in range(5)]
    )
    out, result = apply_kick_gain(peaks, FPS, THRESHOLDS, KICK_GAIN)
    assert not result.applied and out.score.tolist() == peaks.score.tolist()
    out, result = apply_kick_gain(peaks, FPS, THRESHOLDS, None)
    assert not result.applied and out.score.tolist() == peaks.score.tolist()


# ---- 노트 만들기 ----


def test_문턱값_이상만_노트로_남고_시각은_프레임_나누기_fps_더하기_옮김():
    peaks = _peaks([(86, "KICK", 600), (172, "SNARE", 599), (258, "RIDE", 650)])
    thresholds = {**THRESHOLDS, "RIDE": 0.65}
    hits = to_hits(peaks, FPS, thresholds, offset_ms=10.0)
    assert [(p, v) for _, p, v in hits] == [("KICK", None), ("RIDE", None)]
    assert hits[0][0] == pytest.approx(86 / FPS + 0.010)
    assert hits[1][0] == pytest.approx(258 / FPS + 0.010)


def _experiment_notes(acts: np.ndarray, rules: dict) -> set[tuple[str, float]]:
    """실험 스크립트(acts_to_notes.py → song_gain.py → ext_rule_eval.apply)의 계산을 그대로 옮긴 비교 기준."""
    from scipy.signal import find_peaks

    gap = max(1, int(round(rules["peak_gap_ms"] / 1000 * FPS)))
    onset, label, score = [], [], []
    for ci, name in enumerate(STRUM_CLASS_PADS):
        idx, props = find_peaks(acts[:, ci], height=rules["peak_floor"], distance=gap)
        onset.extend((idx / FPS).tolist())
        label.extend([name] * len(idx))
        score.extend(np.rint(props["peak_heights"] * 1000).astype(int).tolist())
    order = np.argsort(onset, kind="stable")
    onset = np.array(onset, dtype=np.float64)[order]
    label = np.array(label, dtype="U16")[order]
    score = np.array(score, dtype=np.float64)[order]
    thr = {p: int(round(v * 1000)) for p, v in rules["thresholds"].items()}
    kg = rules["kick_gain"]
    toms = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
    is_kick = label == "KICK"
    n_kick = int((score[is_kick] >= thr["KICK"]).sum())
    n_tom = sum(int((score[label == t] >= thr[t]).sum()) for t in toms)
    counted = score[is_kick][score[is_kick] >= kg["floor"] * 1000]
    if len(counted) >= kg["min_peaks"] and n_tom > n_kick:
        g = float(
            np.clip(
                kg["target"] * 1000 / np.percentile(counted, kg["percentile"]), 1.0, kg["max_gain"]
            )
        )
        if g > 1.0:
            score[is_kick] = np.minimum(score[is_kick] * g, 1000)
            strong = np.sort(onset[is_kick & (score >= thr["KICK"])])
            if len(strong):
                for t in toms:
                    idx = np.flatnonzero(label == t)
                    pos = np.searchsorted(strong, onset[idx]).clip(1, len(strong) - 1)
                    near = np.minimum(
                        np.abs(strong[pos] - onset[idx]), np.abs(strong[pos - 1] - onset[idx])
                    )
                    score[idx[near <= kg["near_ms"] / 1000]] = 0
    score = np.rint(score).astype(np.int64)
    return {
        (str(p), round(float(t), 9))
        for t, p, s in zip(onset, label, score, strict=True)
        if s >= thr[str(p)]
    }


@pytest.mark.parametrize("seed", [0, 1, 2, 3])
def test_무작위_점수에서_실험_스크립트_계산과_같은_노트(seed: int):
    rng = np.random.default_rng(seed)
    rules = {
        "peak_floor": 0.1,
        "peak_gap_ms": 30.0,
        "offset_ms": 0.0,
        "thresholds": {p: 0.55 + 0.02 * i for i, p in enumerate(PADS)},
        "kick_gain": {**KICK_GAIN, "target": 0.9, "min_peaks": 20},
    }
    # 뾰족한 피크가 드문드문 있는 점수. 짝수 seed는 킥을 작게 해서 킥 규칙이 걸리게, 홀수 seed는 탐을 작게 해서 안 걸리게 함
    acts = rng.random((6000, 8), dtype=np.float32) ** 12
    if seed % 2 == 0:
        acts[:, STRUM_CLASS_PADS.index("KICK")] *= 0.55
    else:
        for tom in ("SMALL_TOM", "MID_TOM", "FLOOR_TOM"):
            acts[:, STRUM_CLASS_PADS.index(tom)] *= 0.5
    hits, result = acts_to_hits(acts, STRUM_CLASS_PADS, FPS, rules)
    assert result.applied == (seed % 2 == 0)
    assert {(p, round(t, 9)) for t, p, _ in hits} == _experiment_notes(acts, rules)
    assert [t for t, _, _ in hits] == sorted(t for t, _, _ in hits)


def test_rules_검사():
    ok = {"thresholds": dict(THRESHOLDS), "kick_gain": {"target": 0.8}}
    rules = rules_with_defaults(ok)
    assert rules["peak_floor"] == 0.1 and rules["kick_gain"]["max_gain"] == 2.5
    assert rules_with_defaults({"thresholds": dict(THRESHOLDS)})["kick_gain"] is None
    with pytest.raises(ValueError, match="패드 8종"):
        rules_with_defaults({"thresholds": {"KICK": 0.6}})
    with pytest.raises(ValueError, match="모르는 STRUM rules"):
        rules_with_defaults({**ok, "window_ms": 120})
    with pytest.raises(ValueError, match="target"):
        rules_with_defaults({"thresholds": dict(THRESHOLDS), "kick_gain": {"max_gain": 2}})


def test_구간_시작_프레임은_절반씩_겹쳐_끝까지_덮음():
    assert segment_starts(5, 10) == [0]
    assert segment_starts(10, 10) == [0]
    assert segment_starts(25, 10) == [0, 5, 10, 15]
    assert segment_starts(27, 10) == [0, 5, 10, 15, 20]
    for total in (1, 9, 10, 11, 99, 861, 1000):
        starts = segment_starts(total, 10)
        assert starts[0] == 0 and starts[-1] + 10 >= total


# ---- 모델 yaml·어댑터 ----


def test_서비스_모델_yaml을_읽고_어댑터가_등록돼_있음():
    cfg = TranscriberConfig.from_yaml(MODEL_YAML)
    assert ADAPTERS[cfg.adapter] is StrumCrnnTranscriber
    assert cfg.eight_pad and not cfg.velocity
    rules = rules_with_defaults(cfg.rules)
    assert set(rules["thresholds"]) == set(PADS)
    assert rules["kick_gain"]["target"] == pytest.approx(0.79355)
    transcriber = create_transcriber(cfg, "cpu")  # 가중치는 load()에서 읽음
    assert transcriber.fps == pytest.approx(86.1328125)
    assert len(str(cfg.options["sha256"])) == 64


def _small_config(weights: Path, **options) -> TranscriberConfig:
    return TranscriberConfig.from_dict(
        {
            "name": "strum_small",
            "adapter": "strum_crnn",
            "license_code": "MIT",
            "license_weights": "테스트용 무작위 가중치",
            "checkpoint_path": str(weights),
            "options": {"model": dict(SMALL_MODEL), "segment_sec": 2, "batch": 2, **options},
            "rules": {"thresholds": {p: 0.5 for p in PADS}, "kick_gain": dict(KICK_GAIN)},
            "labels": {p: p for p in PADS},
        }
    )


@pytest.fixture
def small_weights(tmp_path: Path) -> Path:
    """작은 구조의 무작위 가중치 파일."""
    torch = pytest.importorskip("torch")
    pytest.importorskip("torchaudio")
    import contextlib
    import io

    from ssaplash_ai.bench.transcribers.strum import drums_v13
    from ssaplash_ai.bench.transcribers.strum_transcriber import DEFAULT_MODEL

    torch.manual_seed(0)
    with contextlib.redirect_stdout(io.StringIO()):
        model = drums_v13.TwoStageDrumsCRNN(dropout=0.0, **{**DEFAULT_MODEL, **SMALL_MODEL})
        model.add_multiclass_onset_head()
    path = tmp_path / "strum_small" / "best.pt"
    path.parent.mkdir()
    torch.save({"model_state_dict": model.state_dict(), "step": 1}, path)
    return path


def test_작은_무작위_모델로_올리기_채보_닫기(small_weights: Path, capsys):
    cfg = _small_config(small_weights, sha256=file_sha256(small_weights))
    transcriber = create_transcriber(cfg, "cpu")
    assert transcriber.load() >= 0
    assert capsys.readouterr().out == ""  # 모델 클래스가 찍는 줄이 표준 출력에 안 나감
    rng = np.random.default_rng(0)
    audio = (rng.standard_normal((2, 44100 * 5)) * 0.1).astype(np.float32)
    acts = transcriber.activations(audio, 44100)
    assert acts.shape == (44100 * 5 // 512 + 1, 8)
    assert np.isfinite(acts).all() and acts.min() >= 0 and acts.max() <= 1
    # 표본화 주파수가 달라도 44.1kHz로 바꿔 같은 길이의 점수가 나옴
    assert transcriber.activations(audio[:, ::2], 22050).shape[0] == acts.shape[0]
    result = transcriber.transcribe(audio, 44100)
    assert set(result.hits_pred["pad"]) <= set(PADS)
    assert (np.diff(result.hits_pred["time_sec"]) >= 0).all()
    assert transcriber.last_kick_gain is not None
    info = transcriber.info()
    assert info.checkpoint == "strum_small/best.pt" and info.n_params > 0 and info.eight_pad
    # 계산하는 동안만 cudnn.benchmark를 끄고, 끝나면 원래 값으로 되돌림
    import torch

    before = torch.backends.cudnn.benchmark
    torch.backends.cudnn.benchmark = True
    try:
        assert np.allclose(transcriber.activations(audio, 44100), acts, atol=1e-5)
        assert torch.backends.cudnn.benchmark is True
    finally:
        torch.backends.cudnn.benchmark = before
    # 무음이 아닌 아주 짧은 입력(구간 하나보다 짧음)도 처리
    assert transcriber.activations(audio[:, :3000], 44100).shape == (3000 // 512 + 1, 8)
    transcriber.close()
    assert not transcriber.loaded


def test_가중치_파일이_없거나_sha256이_다르면_오류(small_weights: Path, tmp_path: Path):
    missing = create_transcriber(_small_config(tmp_path / "none" / "best.pt"), "cpu")
    with pytest.raises(FileNotFoundError, match="가중치 파일이 없음"):
        missing.load()
    wrong = create_transcriber(_small_config(small_weights, sha256="0" * 64), "cpu")
    with pytest.raises(ValueError, match="sha256"):
        wrong.load()


def test_어댑터_설정_검사(tmp_path: Path):
    with pytest.raises(ValueError, match="checkpoint_path"):
        cfg = _small_config(tmp_path / "best.pt")
        cfg.checkpoint_path = None
        create_transcriber(cfg, "cpu")
    with pytest.raises(ValueError, match="모르는 options"):
        create_transcriber(_small_config(tmp_path / "best.pt", hop=256), "cpu")
    with pytest.raises(ValueError, match=r"options\.model"):
        cfg = _small_config(tmp_path / "best.pt")
        cfg.options["model"]["layers"] = 3
        create_transcriber(cfg, "cpu")
