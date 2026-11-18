"""ADTOF 파인튜닝 모듈 테스트. 합성 데이터로 CPU에서 몇 스텝만.

torch·adtof_pytorch(extra transcribers)가 없으면 건너뜀. 실제 학습은 GPU 서버에서.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import yaml

torch = pytest.importorskip("torch")
adtof = pytest.importorskip("adtof_pytorch")

from helpers import SR, make_hits, make_synth_song, write_wav  # noqa: E402
from ssaplash_ai.bench.datasets import DatasetConfig, SongItem, load_dataset  # noqa: E402
from ssaplash_ai.bench.datasets.pads import HITS_DTYPE  # noqa: E402
from ssaplash_ai.train import adtof_data as D  # noqa: E402
from ssaplash_ai.train import adtof_eval as E  # noqa: E402
from ssaplash_ai.train import adtof_finetune as T  # noqa: E402

# 5초 합성곡: 탐이 2.5초에 하나, 나머지는 킥·스네어·하이햇
SONG_SEC = 5.0
ONSETS = [0.3, 1.0, 2.5, 4.0]
CLASSES = [(36, "kick", 100), (38, "snare", 90), (45, "tom_mid", 80), (42, "hihat_closed", 70)]


def hits(rows: list[tuple[float, str]]) -> np.ndarray:
    return np.array([(t, p, -1) for t, p in rows], dtype=HITS_DTYPE)


def song_item(seconds: float = SONG_SEC, with_accomp: bool = True) -> SongItem:
    drums = make_hits(seconds, [t for t in ONSETS if t + 0.1 < seconds])
    accomp = np.zeros_like(drums)
    if with_accomp:
        accomp[:] = 0.2 * np.sin(2 * np.pi * 110.0 * np.arange(drums.shape[1]) / SR)
    return SongItem(
        dataset="t",
        song_id="s",
        sample_rate=SR,
        mixture=drums + accomp,
        drums_true=drums,
        accomp_true=accomp,
        hits_true=hits([(0.3, "KICK"), (1.0, "SNARE"), (2.5, "MID_TOM"), (4.0, "HIHAT")]),
    )


@pytest.fixture
def synth_yaml(tmp_path: Path) -> Path:
    """곡 2개짜리 합성 데이터셋 yaml."""
    root = tmp_path / "synth"
    for name in ("a", "b"):
        make_synth_song(root / name, SONG_SEC, ONSETS, CLASSES)
    path = tmp_path / "synth.yaml"
    path.write_text(
        yaml.safe_dump({"name": "fake_synth", "kind": "synth", "root": str(root)}), encoding="utf-8"
    )
    return path


# ---------- 특징·정답 ----------


def test_특징이_추론_입력과_같다(tmp_path: Path):
    audio = make_hits(2.0)
    path = tmp_path / "a.wav"
    write_wav(path, audio)
    ours = D.features(audio)
    theirs = adtof.load_audio_for_model(str(path))[0, :, :, 0].numpy()
    assert ours.shape == theirs.shape == (201, 84)
    np.testing.assert_allclose(ours, theirs, atol=2e-3)


def test_프레임_정답은_타격_앞뒤로_번진다():
    h = hits([(0.10, "KICK"), (0.20, "MID_TOM"), (0.25, "RIDE")])
    five = D.frame_targets(h, 30, "five", label_radiation=1)
    assert five.shape == (30, 5)
    assert five[9:12, 0].tolist() == [1, 1, 1] and five[8, 0] == 0 and five[12, 0] == 0
    assert five[19:22, 2].tolist() == [1, 1, 1]  # 탐 채널
    assert five[24:27, 4].tolist() == [1, 1, 1]  # 심벌 채널
    pads = D.frame_targets(h, 30, "pads", label_radiation=0)
    assert pads.shape == (30, 9)
    assert pads[20, 3] == 1 and pads[19, 3] == 0 and pads[25, 7] == 1
    assert D.tom_indices("five") == [2] and D.tom_indices("pads") == [2, 3, 4]


def test_탐_중심_윈도는_탐_타격을_포함한다():
    song = song_item()
    cfg = D.WindowConfig(tom_window_frac=1.0, accomp_mix_prob=0.0, gain_db_range=(0, 0))
    rng = np.random.default_rng(0)
    for _ in range(5):
        start, centered = D.choose_start(song, rng, cfg)
        assert centered
        feat, target = D.cut_window(song, start, rng, cfg)
        assert feat.shape == (412, 84) and target.shape == (412, 5)
        tom_frames = np.where(target[:, 2] > 0)[0]
        assert len(tom_frames) == 3
        expected = round((2.5 - start / SR) * 100)
        assert abs(int(tom_frames[1]) - expected) <= 1
    cfg0 = D.WindowConfig(tom_window_frac=0.0)
    assert D.choose_start(song, rng, cfg0)[1] is False


def test_반주_섞기와_게인은_확률대로_적용된다():
    song = song_item()
    rng = np.random.default_rng(1)
    plain = D.WindowConfig(accomp_mix_prob=0.0, gain_db_range=(0, 0))
    mixed = D.WindowConfig(accomp_mix_prob=1.0, accomp_gain_range=(0.3, 0.3), gain_db_range=(0, 0))
    f0, _ = D.cut_window(song, 0, rng, plain)
    f1, _ = D.cut_window(song, 0, rng, mixed)
    assert not np.allclose(f0, f1)
    # 110Hz 반주가 섞이면 낮은 빈의 에너지가 커짐
    assert f1[:, :20].mean() > f0[:, :20].mean()
    np.testing.assert_allclose(D.cut_window(song, 0, rng, plain)[0], f0)


def test_짧은_곡은_뒤를_0으로_채운다():
    song = song_item(seconds=2.0)
    song.hits_true = hits([(0.3, "KICK"), (1.0, "SNARE")])
    rng = np.random.default_rng(0)
    start, centered = D.choose_start(song, rng, D.WindowConfig())
    assert start == 0 and not centered
    feat, target = D.cut_window(song, 0, rng, D.WindowConfig(gain_db_range=(0, 0)))
    assert feat.shape == (412, 84) and target[:, 0].sum() == 3 and target[:, 1].sum() == 3


def test_곡_모음은_비율대로_뽑는다(synth_yaml: Path):
    pool = D.SongPool.from_specs([D.DatasetSpec(synth_yaml, 1.0), D.DatasetSpec(synth_yaml, 0.0)])
    assert pool.n_songs == 4 and len(pool.digest()) == 12
    rng = np.random.default_rng(0)
    assert all(pool.draw(rng)[0] is pool.loaders[0] for _ in range(20))
    with pytest.raises(ValueError, match="weight"):
        D.SongPool.from_specs([D.DatasetSpec(synth_yaml, 0.0)])


def test_윈도_데이터셋은_배치_모양을_낸다(synth_yaml: Path):
    pool = D.SongPool.from_specs([D.DatasetSpec(synth_yaml)])
    ds = D.WindowDataset(pool, D.WindowConfig(classes="pads"), seed=0, windows_per_song=2)
    x, y, m = next(iter(ds))
    assert tuple(x.shape) == (412, 84, 1) and tuple(y.shape) == (412, 9)
    assert m.tolist() == [1.0] * 9


def test_윈도_데이터셋은_데이터셋별_손실_마스크를_낸다(synth_yaml: Path):
    pool = D.SongPool.from_specs([D.DatasetSpec(synth_yaml, ignore_classes=("pedal",))])
    ds = D.WindowDataset(pool, D.WindowConfig(classes="five_pedal"), seed=0, windows_per_song=1)
    _, y, m = next(iter(ds))
    assert tuple(y.shape) == (412, 6) and m.tolist() == [1.0, 1.0, 1.0, 1.0, 1.0, 0.0]
    with pytest.raises(ValueError, match="ignore_classes"):
        D.loss_mask("five", ("pedal",))


def test_손실_마스크가_없거나_전부_1이면_손실이_같다():
    torch.manual_seed(0)
    pred = torch.rand(2, 10, 6).clamp(0.01, 0.99)
    target = (torch.rand(2, 10, 6) > 0.7).float()
    pw = torch.tensor([1.0, 2.0, 3.0, 1.0, 1.5, 2.0])
    plain = T.weighted_bce(pred, target, pw)
    ones = T.weighted_bce(pred, target, pw, torch.ones(2, 6))
    torch.testing.assert_close(plain, ones)


def test_손실_마스크_0인_채널은_기울기가_0이다():
    torch.manual_seed(0)
    pred = torch.rand(2, 10, 6).clamp(0.01, 0.99).requires_grad_(True)
    target = (torch.rand(2, 10, 6) > 0.5).float()
    mask = torch.tensor([[1.0, 1, 1, 1, 1, 0], [1, 1, 1, 1, 1, 1]])
    T.weighted_bce(pred, target, torch.ones(6), mask).backward()
    assert torch.all(pred.grad[0, :, 5] == 0)
    assert torch.any(pred.grad[1, :, 5] != 0) and torch.any(pred.grad[0, :, 0] != 0)


def test_학습_설정의_ignore_classes는_클래스_이름이어야_한다():
    cfg = T.TrainConfig.from_dict(
        {
            "classes": "five_pedal",
            "train_datasets": [{"path": "x", "weight": 0.2, "ignore_classes": ["pedal"]}],
        }
    )
    assert cfg.train_datasets[0].ignore_classes == ("pedal",)
    with pytest.raises(ValueError, match="ignore_classes"):
        T.TrainConfig.from_dict(
            {"classes": "five", "train_datasets": [{"path": "x", "ignore_classes": ["pedal"]}]}
        )


# ---------- 모델·체크포인트 ----------


def test_출력층_5에서_9로_복사_초기화():
    state, _ = T.read_checkpoint(T.default_base_checkpoint())
    wide = T.expand_output_layer(state, 9)
    w5, w9 = state["output_layer.weight"], wide["output_layer.weight"]
    assert w9.shape == (9, 120)
    torch.testing.assert_close(w9[2], w5[2])  # SMALL_TOM ← 탐
    torch.testing.assert_close(w9[4], w5[2])  # FLOOR_TOM ← 탐
    torch.testing.assert_close(w9[7], w5[4])  # RIDE ← 심벌
    torch.testing.assert_close(w9[5], w5[3])  # HIHAT ← 하이햇
    torch.testing.assert_close(w9[8], w5[3])  # HIHAT_PEDAL ← 하이햇
    model = T.build_model(9)
    T.load_base(model, T.default_base_checkpoint(), 9)
    assert model.output_layer.out_features == 9
    with pytest.raises(ValueError):
        T.expand_output_layer(state, 8)


def test_출력층_5에서_6으로_페달은_하이햇에서_복사():
    state, _ = T.read_checkpoint(T.default_base_checkpoint())
    wide = T.expand_output_layer(state, 6)
    w5, w6 = state["output_layer.weight"], wide["output_layer.weight"]
    b5, b6 = state["output_layer.bias"], wide["output_layer.bias"]
    torch.testing.assert_close(w6[:5], w5)
    torch.testing.assert_close(w6[5], w5[3])
    torch.testing.assert_close(b6[5], b5[3])
    assert D.class_names("five_pedal")[-1] == "pedal"
    assert T.model_info("five_pedal", E.default_thresholds("five_pedal"))["classes"] == [
        35,
        38,
        47,
        42,
        49,
        44,
    ]


def test_five_pedal_정답은_페달을_따로_five는_하이햇으로():
    h = hits([(0.1, "HIHAT_PEDAL"), (0.3, "HIHAT")])
    y5 = D.frame_targets(h, 50, "five", label_radiation=0)
    y6 = D.frame_targets(h, 50, "five_pedal", label_radiation=0)
    assert y5.shape == (50, 5) and y5[10, 3] == 1 and y5[30, 3] == 1
    assert y6.shape == (50, 6) and y6[10, 5] == 1 and y6[10, 3] == 0 and y6[30, 3] == 1
    y9 = D.frame_targets(h, 50, "pads", label_radiation=0)
    assert y9[10, D.PAD_ORDER.index("HIHAT_PEDAL")] == 1


def test_페달_가중치_배수():
    cfg = T.TrainConfig.from_dict(
        {
            "classes": "five_pedal",
            "train_datasets": [],
            "tom_weight_mult": 1.0,
            "pedal_weight_mult": 3.0,
        }
    )
    w = cfg.positive_weights()
    assert len(w) == 6 and w[5].item() == pytest.approx(1.144 * 3.0)
    assert w[3].item() == pytest.approx(1.144)


def test_기준값_검사는_5가지_중_하나라도_떨어지면_거짓():
    ref = {f"f1_{k}": 0.8 for k in D.FIVE_ORDER}
    ok = {f"f1_{k}": 0.79 for k in D.FIVE_ORDER}
    assert T.guard_ok(ok, ref, 0.02)
    bad = {**ok, "f1_kick": 0.77}
    assert not T.guard_ok(bad, ref, 0.02)


def test_기본_가중치를_그대로_넣으면_추론과_같은_활성값():
    model = T.build_model(5)
    T.load_base(model, T.default_base_checkpoint(), 5)
    ref = adtof.load_pytorch_weights(adtof.create_frame_rnn_model(84), T.default_base_checkpoint())
    ref.eval()
    feat = D.features(make_hits(2.0))
    ours = E.model_activations(model, feat)
    with torch.no_grad():
        theirs = ref(torch.from_numpy(feat)[None, :, :, None])[0].numpy()
    np.testing.assert_allclose(ours, theirs, atol=1e-5)


def test_가중_교차_엔트로피는_양성에_가중치를_준다():
    pred = torch.full((1, 4, 2), 0.5)
    target = torch.tensor([[[1, 0], [0, 0], [0, 0], [0, 0]]], dtype=torch.float32)
    w1 = T.weighted_bce(pred, target, torch.tensor([1.0, 1.0]))
    w3 = T.weighted_bce(pred, target, torch.tensor([3.0, 1.0]))
    assert w3 > w1
    cfg = T.TrainConfig.from_dict(
        {"train_datasets": [{"path": "x"}], "classes": "five", "tom_weight_mult": 2.0}
    )
    w = cfg.positive_weights()
    assert pytest.approx(w[2].item(), rel=1e-6) == 3.414 * 2 and pytest.approx(w[0].item()) == 1.078
    with pytest.raises(ValueError, match="모르는 키"):
        T.TrainConfig.from_dict({"train_datasets": [], "foo": 1})


# ---------- 평가 ----------


def test_활성값을_타격표로_바꾸고_점수를_낸다():
    act = np.zeros((300, 5), dtype=np.float32)
    act[50, 0] = 0.9  # 킥 0.5초
    act[120, 2] = 0.9  # 탐 1.2초
    pred = E.activations_to_hits(act, "five", E.default_thresholds("five"))
    assert pred["pad"].tolist() == ["KICK", "tom"]
    song = song_item(seconds=3.0)
    song.hits_true = hits([(0.5, "KICK"), (1.2, "FLOOR_TOM"), (2.0, "SNARE")])
    res = E.evaluate_activations([(song, act)], "five", E.default_thresholds("five"))
    assert res.tom_f1 == 1.0 and res.by_five["snare"].fn == 1
    assert res.metrics()["f1_snare"] == 0.0 and 0 < res.f1 < 1
    act8 = np.zeros((300, 9), dtype=np.float32)
    act8[120, 4] = 0.9
    pred8 = E.activations_to_hits(act8, "pads", E.default_thresholds("pads"))
    assert pred8["pad"].tolist() == ["FLOOR_TOM"]
    res8 = E.evaluate_activations([(song, act8)], "pads", E.default_thresholds("pads"))
    assert res8.by_class["FLOOR_TOM"].tp == 1 and res8.by_five["tom"].tp == 1


def test_문턱값_맞추기는_격자_안에서_고른다():
    act = np.zeros((200, 5), dtype=np.float32)
    act[50, 0] = 0.5  # 킥 0.5초, 점수 0.5
    act[90, 0] = 0.3  # 헛것. 기본 문턱값 0.22로는 잡히고 0.4면 걸러짐
    song = song_item(seconds=2.0)
    song.hits_true = hits([(0.5, "KICK")])
    fitted = E.fit_thresholds([(song, act)], "five", grid=[0.1, 0.2, 0.4])
    assert fitted[0] == 0.4 and fitted[1:] == E.default_thresholds("five")[1:]
    act[90, 0] = 0.0
    assert E.fit_thresholds([(song, act)], "five", grid=[0.1, 0.4]) == E.default_thresholds("five")


# ---------- 학습 루프 왕복 ----------


def train_config(synth_yaml: Path, classes: str) -> T.TrainConfig:
    return T.TrainConfig.from_dict(
        {
            "classes": classes,
            "train_datasets": [{"path": str(synth_yaml), "weight": 1.0}],
            "val_datasets": [{"path": str(synth_yaml), "n_songs": 1}],
            "batch_size": 2,
            "steps_per_epoch": 2,
            "max_epochs": 2,
            "windows_per_song": 2,
            "num_workers": 0,
            "device": "cpu",
            "learning_rate": 1e-4,
            "fit_thresholds": True,
        }
    )


def test_학습_몇_스텝과_체크포인트_왕복(synth_yaml: Path, tmp_path: Path):
    from ssaplash_ai.bench.transcribers import create_transcriber
    from ssaplash_ai.bench.transcribers.transcriber_base import TranscriberConfig

    out = tmp_path / "ft"
    logs: list[str] = []
    best = T.train(train_config(synth_yaml, "five"), out, log=logs.append)
    assert best == out / "best.pth" and (out / "last.pth").is_file()
    assert (out / "config.yaml").is_file()
    log_rows = (out / "log.csv").read_text(encoding="utf-8").splitlines()
    # 머리줄 + 학습 전(에폭 -1) + 에폭 2개
    assert len(log_rows) == 4 and "val_tom_f1" in log_rows[0] and "guard" in log_rows[0]
    assert log_rows[1].startswith("-1,0,")
    assert any("기준값(기본 가중치 5클래스)" in m for m in logs)
    assert "_reference" in yaml.safe_load((out / "config.yaml").read_text(encoding="utf-8"))
    state, info = T.read_checkpoint(best)
    assert info["class_set"] == "five" and info["classes"] == [35, 38, 47, 42, 49]
    assert len(info["thresholds"]) == 5 and "thresholds_default" in info
    assert any("문턱값 맞춤" in m for m in logs)
    assert state["output_layer.weight"].shape == (5, 120)

    # 어댑터가 체크포인트의 문턱값·클래스를 읽어 그대로 돈다
    cfg = TranscriberConfig.from_dict(
        {
            "name": "ft",
            "adapter": "adtof",
            "license_code": "x",
            "license_weights": "x",
            "checkpoint_path": str(best),
            "labels": {35: "KICK", 38: "SNARE", 42: "HIHAT", 47: "tom", 49: "cymbal"},
        }
    )
    tr = create_transcriber(cfg, device="cpu")
    tr.load()
    assert tr._thresholds == info["thresholds"]
    result = tr.transcribe(make_hits(2.0), SR)
    assert result.hits_pred.dtype == HITS_DTYPE
    tr.close()


def test_9클래스_학습과_어댑터_패드_라벨(synth_yaml: Path, tmp_path: Path):
    from ssaplash_ai.bench.transcribers import create_transcriber
    from ssaplash_ai.bench.transcribers.transcriber_base import TranscriberConfig

    out = tmp_path / "ft8"
    cfg = train_config(synth_yaml, "pads")
    cfg.max_epochs = 1
    cfg.fit_thresholds = False
    best = T.train(cfg, out, log=lambda _m: None)
    state, info = T.read_checkpoint(best)
    assert state["output_layer.weight"].shape == (9, 120)
    assert info["classes"] == list(D.PAD_ORDER) and len(info["thresholds"]) == 9

    tcfg = TranscriberConfig.from_dict(
        {
            "name": "ft8",
            "adapter": "adtof",
            "license_code": "x",
            "license_weights": "x",
            "checkpoint_path": str(best),
            "labels": {p: p for p in D.PAD_ORDER},
        }
    )
    tr = create_transcriber(tcfg, device="cpu")
    tr.load()
    assert tr.info().eight_pad
    act = np.zeros((100, 9), dtype=np.float32)
    act[30, 4] = 0.9
    assert tr.peaks(act) == {**{p: [] for p in D.PAD_ORDER}, "FLOOR_TOM": [0.3]}
    result = tr.transcribe(make_hits(2.0), SR)
    assert set(result.hits_pred["pad"].tolist()) <= set(D.PAD_ORDER)
    tr.close()


def test_adtof_eval_명령은_표를_만든다(synth_yaml: Path, tmp_path: Path):
    from ssaplash_ai.train.cli import main

    out = tmp_path / "eval"
    code = main(
        [
            "adtof-eval",
            "--dataset",
            str(synth_yaml),
            "--n-songs",
            "1",
            "--device",
            "cpu",
            "--out",
            str(out),
        ]
    )
    assert code == 0
    md = (out / "summary.md").read_text(encoding="utf-8")
    assert "tom_f1" in md and "fake_synth" in md
    assert (out / "summary.csv").read_text(encoding="utf-8").count("\n") == 2


def test_load_songs는_고정_시드로_일부만(synth_yaml: Path):
    songs = E.load_songs(synth_yaml, n_songs=1, seed=3)
    assert len(songs) == 1 and songs[0].hits_true is not None
    cfg = DatasetConfig.from_yaml(synth_yaml)
    assert len(load_dataset(cfg).song_ids()) == 2


def test_페달_학습은_6출력_체크포인트를_내고_분리_어댑터가_44를_페달로(
    synth_yaml: Path, tmp_path: Path
):
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
        assign_pads,
        pick_tom_times,
    )

    out = tmp_path / "ft6"
    cfg = train_config(synth_yaml, "five_pedal")
    cfg.max_epochs = 1
    cfg.fit_thresholds = False
    cfg.select_metric = "tom_pedal_f1"
    logs: list[str] = []
    best = T.train(cfg, out, log=logs.append)
    state, info = T.read_checkpoint(best)
    assert state["output_layer.weight"].shape == (6, 120)
    assert info["class_set"] == "five_pedal" and info["classes"][-1] == 44
    header = (out / "log.csv").read_text(encoding="utf-8").splitlines()[0]
    assert "val_pedal_f1" in header and "val_tom_pedal_f1" in header

    # 6열 활성값에서도 탐 시각을 고르고, 44번 피크는 HIHAT_PEDAL
    act = np.zeros((100, 6), dtype=np.float32)
    act[40, 2] = 0.9
    times, _ = pick_tom_times(act, {"tom_peak_mode": "raw", "tom_threshold": 0.5})
    assert times == [0.4]
    stems = {n: np.zeros((2, SR)) for n in ("toms", "crash", "ride")}
    raw = assign_pads({42: [0.1], 44: [0.2]}, stems, SR, {})
    assert [(t, p) for t, p, _ in raw] == [(0.1, "HIHAT"), (0.2, "HIHAT_PEDAL")]


def test_기준값을_넘는_에폭이_없으면_마지막_가중치와_경고(
    synth_yaml: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    # 기준값을 1.0보다 크게 두면 어느 에폭도 조건을 못 넘음
    monkeypatch.setattr(
        T,
        "reference_metrics",
        lambda *a, **k: {f"f1_{c}": 2.0 for c in D.FIVE_ORDER} | {"pedal_f1": 0.0},
    )
    out = tmp_path / "ft_guard"
    cfg = train_config(synth_yaml, "five")
    cfg.max_epochs = 1
    cfg.fit_thresholds = False
    logs: list[str] = []
    best = T.train(cfg, out, log=logs.append)
    assert best.is_file()
    assert any("기준값 조건을 넘는 에폭이 없어" in m for m in logs)
    rows = (out / "log.csv").read_text(encoding="utf-8").splitlines()
    assert rows[0].endswith("guard,best") and all(r.endswith(",0,0") for r in rows[1:])


def test_five_pedal_cym는_크래시_라이드를_따로_채널로():
    assert D.class_names("five_pedal_cym") == (
        "kick",
        "snare",
        "tom",
        "hihat",
        "crash",
        "pedal",
        "ride",
    )
    h = hits([(0.1, "CRASH"), (0.2, "RIDE"), (0.3, "HIHAT_PEDAL"), (0.4, "MID_TOM")])
    y = D.frame_targets(h, 50, "five_pedal_cym", label_radiation=0)
    assert y.shape == (50, 7)
    assert y[10, 4] == 1 and y[20, 6] == 1 and y[30, 5] == 1 and y[40, 2] == 1
    assert y[20, 4] == 0 and y[10, 6] == 0
    state, _ = T.read_checkpoint(T.default_base_checkpoint())
    w5 = state["output_layer.weight"]
    w7 = T.expand_output_layer(state, 7)["output_layer.weight"]
    torch.testing.assert_close(w7[:5], w5)
    torch.testing.assert_close(w7[5], w5[3])  # 페달 ← 하이햇
    torch.testing.assert_close(w7[6], w5[4])  # 라이드 ← 심벌
    info = T.model_info("five_pedal_cym", E.default_thresholds("five_pedal_cym"))
    assert info["classes"] == [35, 38, 47, 42, 49, 44, 51]


def test_five_pedal_cym_평가는_크래시_라이드_F1과_focus_f1을_낸다():
    song = song_item(seconds=3.0)
    song.hits_true = hits([(0.5, "CRASH"), (1.0, "RIDE"), (2.0, "MID_TOM")])
    act = np.zeros((300, 7), dtype=np.float32)
    act[50, 4] = 0.9  # 크래시 맞힘
    act[100, 4] = 0.9  # 라이드를 크래시로 냄
    act[200, 2] = 0.9  # 탐 맞힘
    res = E.evaluate_activations(
        [(song, act)], "five_pedal_cym", E.default_thresholds("five_pedal_cym")
    )
    m = res.metrics()
    assert res.crash.tp == 1 and res.crash.fp == 1 and res.ride.fn == 1
    assert m["f1_ride"] == 0.0 and m["tom_f1"] == 1.0
    # 5가지 기준으로는 심벌 둘 다 맞음
    assert m["f1_cymbal"] == 1.0
    assert m["focus_f1"] == pytest.approx((1.0 + m["pedal_f1"] + m["f1_crash"] + 0.0) / 4)


def test_7출력_학습과_분리_어댑터의_크래시_라이드(synth_yaml: Path, tmp_path: Path):
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import assign_pads, cymbal_pad

    out = tmp_path / "ft7"
    cfg = train_config(synth_yaml, "five_pedal_cym")
    cfg.max_epochs = 1
    cfg.fit_thresholds = False
    cfg.select_metric = "focus_f1"
    best = T.train(cfg, out, log=lambda _m: None)
    state, info = T.read_checkpoint(best)
    assert state["output_layer.weight"].shape == (7, 120) and info["classes"][-1] == 51
    header = (out / "log.csv").read_text(encoding="utf-8").splitlines()[0]
    assert "val_focus_f1" in header and "val_f1_crash" in header

    stems = {n: np.zeros((2, SR)) for n in ("toms", "crash", "ride")}
    # 51번이 있으면 49는 크래시, 51은 라이드 그대로
    raw = assign_pads({49: [0.1], 51: [0.2]}, stems, SR, {})
    assert [(t, p) for t, p, _ in raw] == [(0.1, "CRASH"), (0.2, "RIDE")]
    # 51번이 없으면 지금 규칙: 트랙 에너지 비교. 크래시 가중치로 기울일 수 있음
    crash, ride = np.full((2, 100), 0.1), np.full((2, 100), 0.2)
    assert cymbal_pad(crash, ride, 1e-8) == "RIDE"
    assert cymbal_pad(crash, ride, 1e-8, crash_weight=5.0) == "CRASH"


def test_이어_학습_자리는_log_csv로_다시_계산한다(tmp_path: Path):
    cfg = T.TrainConfig.from_dict(
        {
            "classes": "five",
            "train_datasets": [],
            "val_datasets": [],
            "learning_rate": 1e-4,
            "lr_reduce_patience": 2,
            "early_stop_patience": 4,
        }
    )
    assert T.resume_point(tmp_path, cfg) is None  # last.pth가 없으면 처음부터
    (tmp_path / "last.pth").write_bytes(b"")
    head = "epoch,step,lr,loss,sec,val_tom_f1,guard,best\n"
    rows = [
        "-1,0,0.0001,nan,0,0.40,1,1",
        "0,10,0.0001,0.1,5,0.50,1,1",
        "1,20,0.0001,0.09,10,0.48,1,0",
        "2,30,0.0001,0.08,15,0.49,1,0",
    ]
    (tmp_path / "log.csv").write_text(head + "\n".join(rows) + "\n", encoding="utf-8")
    (tmp_path / "config.yaml").write_text("_songs_digest: abc\n", encoding="utf-8")
    at = T.resume_point(tmp_path, cfg)
    assert at is not None
    assert (at.start_epoch, at.sec, at.state.step) == (3, 15, 30)
    assert (at.state.best_metric, at.state.best_epoch, at.state.bad_epochs) == (0.50, 0, 2)
    # 안 오른 에폭 2 → 루프 끝에서 학습률을 줄였을 자리
    assert at.state.lr == pytest.approx(2e-5)
    assert at.config["_songs_digest"] == "abc" and at.fieldnames[-1] == "best"


def test_끊긴_학습을_이어_돌리면_에폭과_스텝이_이어진다(synth_yaml: Path, tmp_path: Path):
    out = tmp_path / "ft"
    cfg = train_config(synth_yaml, "five")
    T.train(cfg, out, log=lambda m: None)
    before = (out / "log.csv").read_text(encoding="utf-8").splitlines()

    cfg.max_epochs = 4
    logs: list[str] = []
    best = T.train(cfg, out, log=logs.append, resume=True)
    rows = (out / "log.csv").read_text(encoding="utf-8").splitlines()
    assert rows[: len(before)] == before  # 앞 줄은 그대로, 머리줄은 한 번
    assert [r.split(",")[0] for r in rows[1:]] == ["-1", "0", "1", "2", "3"]
    assert [r.split(",")[1] for r in rows[4:]] == ["6", "8"]
    assert any("이어 학습: 에폭 2부터" in m for m in logs)
    assert any("문턱값 맞춤" in m for m in logs) and best.is_file()
    saved = yaml.safe_load((out / "config.yaml").read_text(encoding="utf-8"))
    assert saved["_resumed"][0]["from_epoch"] == 2 and "_reference" in saved


def test_이미_끝난_학습을_이어_돌리면_문턱값만_맞춘다(synth_yaml: Path, tmp_path: Path):
    out = tmp_path / "ft"
    cfg = train_config(synth_yaml, "five")
    T.train(cfg, out, log=lambda m: None)
    before = (out / "log.csv").read_text(encoding="utf-8")
    logs: list[str] = []
    T.train(cfg, out, log=logs.append, resume=True)
    assert (out / "log.csv").read_text(encoding="utf-8") == before
    assert any("이미 끝난 학습" in m for m in logs) and any("문턱값 맞춤" in m for m in logs)


def test_학습_곡이_바뀌면_이어_학습을_멈춘다(synth_yaml: Path, tmp_path: Path):
    out = tmp_path / "ft"
    cfg = train_config(synth_yaml, "five")
    T.train(cfg, out, log=lambda m: None)
    path = out / "config.yaml"
    saved = yaml.safe_load(path.read_text(encoding="utf-8"))
    saved["_songs_digest"] = "다른해시"
    path.write_text(yaml.safe_dump(saved, allow_unicode=True), encoding="utf-8")
    cfg.max_epochs = 3
    with pytest.raises(ValueError, match="이어 학습 멈춤"):
        T.train(cfg, out, log=lambda m: None, resume=True)
