"""채보 어댑터 인터페이스 테스트 (채보 설계 3-8·3-9절). mock 어댑터, yaml 파싱, 대응표·MIDI 저장 공용 함수."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_hits, make_synth_song, make_tone
from ssaplash_ai.bench.datasets import DatasetConfig, SynthDataset
from ssaplash_ai.bench.metrics import score_hits
from ssaplash_ai.bench.transcribers import (
    ADAPTERS,
    MockTranscriber,
    TranscriberConfig,
    apply_labels,
    create_transcriber,
    hits_to_midi,
    map_label,
    midi_raw_hits,
    resample,
    write_truth_csv,
)

CONFIGS_DIR = Path(__file__).resolve().parents[2] / "configs" / "bench" / "transcribers"
IDENTITY = {
    p: p for p in ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
}


def _cfg(**kw) -> TranscriberConfig:
    raw = {
        "name": "m",
        "adapter": "mock",
        "mock_mode": "empty",
        "license_code": "x",
        "license_weights": "y",
        "labels": dict(IDENTITY),
    }
    raw.update(kw)
    return TranscriberConfig.from_dict(raw)


@pytest.fixture
def synth_song(tmp_path: Path):
    """합성곡 1곡과 그 정답 타격 표, mock truth 파일."""
    root = tmp_path / "synth"
    make_synth_song(root / "song_1")
    ds = SynthDataset(DatasetConfig.from_dict({"name": "s", "kind": "synth", "root": str(root)}))
    item = ds.load("song_1")
    truth_dir = tmp_path / "truth"
    write_truth_csv(truth_dir / "song_1.csv", item.hits_true)
    return item, truth_dir


# ---- yaml 파싱 ----


def test_labels_없으면_오류():
    with pytest.raises(ValueError, match="labels"):
        _cfg(labels={})


def test_대응표_값이_어휘_밖이면_오류():
    with pytest.raises(ValueError, match="어휘에 없음"):
        _cfg(labels={"a": "KICK", "b": "COWBELL"})


def test_모르는_필드와_라이선스_누락은_오류():
    with pytest.raises(ValueError, match="모르는 모델 설정 필드"):
        _cfg(tier=1)
    with pytest.raises(ValueError, match="license_weights"):
        TranscriberConfig.from_dict({"name": "m", "adapter": "mock", "license_code": "x"})


def test_eight_pad는_대응표만_보고_정해진다():
    assert _cfg().eight_pad
    assert not _cfg(labels={**IDENTITY, "SMALL_TOM": "tom"}).eight_pad  # 거친 라벨
    assert not _cfg(
        labels={k: v for k, v in IDENTITY.items() if k != "RIDE"}
    ).eight_pad  # 빠진 패드
    assert _cfg(labels={**IDENTITY, "clap": "__drop__"}).eight_pad  # 제외 라벨은 상관없음


def test_config_hash는_대응표가_바뀌면_달라진다():
    a = _cfg()
    b = _cfg(labels={**IDENTITY, "SMALL_TOM": "MID_TOM"})
    assert a.config_hash != b.config_hash and len(a.config_hash) == 12


def test_저장소의_mock_yaml이_전부_읽힌다():
    for path in sorted((CONFIGS_DIR / "mock").glob("*.yaml")):
        cfg = TranscriberConfig.from_yaml(path)
        assert cfg.adapter == "mock" and cfg.labels
    assert "mock" in ADAPTERS


# ---- 대응표 적용 ----


def test_map_label은_정수_키와_문자열_키를_맞춘다():
    labels = {36: "KICK", "38": "SNARE"}
    assert map_label(labels, 36) == "KICK" and map_label(labels, "36") == "KICK"
    assert map_label(labels, 38) == "SNARE" and map_label(labels, "38") == "SNARE"
    assert map_label(labels, 99) is None


def test_apply_labels는_제외_집계와_범위_밖_타격을_처리한다():
    labels = {36: "KICK", 39: "__drop__", 47: "tom"}
    raw = [(0.5, 36, 100), (0.2, 39, None), (0.9, 47, 80), (3.5, 36, 90), (-0.1, 36, 90)]
    res = apply_labels(raw, labels, duration_sec=2.0)
    assert res.hits_pred["time_sec"].tolist() == [0.5, 0.9]
    assert res.hits_pred["pad"].tolist() == ["KICK", "tom"]
    assert res.hits_pred["velocity"].tolist() == [100, 80]
    assert res.hits_pred_dropped == 1 and res.n_out_of_range == 2
    assert res.raw_label_counts == {"36": 3, "39": 1, "47": 1}
    with pytest.raises(ValueError, match="대응표에 없는 라벨"):
        apply_labels([(0.1, 42, None)], labels)


# ---- mock 어댑터 ----


def test_mock_truth는_정답을_그대로_돌려줘_F1이_1(synth_song, tmp_path: Path):
    item, truth_dir = synth_song
    tr = create_transcriber(
        _cfg(mock_mode="truth", truth_dir=str(truth_dir), velocity=True), device="cpu"
    )
    assert isinstance(tr, MockTranscriber)
    assert tr.load() >= 0
    out = tr.transcribe(item.drums_true, item.sample_rate, song_id="song_1")
    assert out.hits_pred.dtype == item.hits_true.dtype
    assert score_hits(item.hits_true, out.hits_pred, "pads").f1 == 1.0
    assert out.hits_pred["velocity"].tolist() == item.hits_true["velocity"].tolist()
    info = tr.info()
    assert info.eight_pad and info.has_velocity and info.checkpoint == "mock:truth"
    tr.close()
    assert not tr.loaded


def test_mock_shift와_coarse(synth_song):
    item, truth_dir = synth_song
    shifted = create_transcriber(
        _cfg(mock_mode="truth", truth_dir=str(truth_dir), shift_ms=30), "cpu"
    )
    shifted.load()
    s = score_hits(
        item.hits_true,
        shifted.transcribe(item.drums_true, SR, "song_1").hits_pred,
        "pads",
    )
    assert s.f1 == 1.0 and s.f1_tight == 0.0 and abs(s.mean_err_ms - 30) < 1e-6

    coarse = create_transcriber(
        _cfg(
            mock_mode="truth",
            truth_dir=str(truth_dir),
            labels={**IDENTITY, "SMALL_TOM": "tom", "MID_TOM": "tom", "FLOOR_TOM": "tom"},
        ),
        "cpu",
    )
    coarse.load()
    assert not coarse.info().eight_pad
    out = coarse.transcribe(item.drums_true, SR, "song_1")
    assert score_hits(item.hits_true, out.hits_pred, "five").f1 == 1.0


def test_mock_empty_clicks_fail():
    empty = create_transcriber(_cfg(), "cpu")
    empty.load()
    assert len(empty.transcribe(make_tone(0.5), SR).hits_pred) == 0

    clicks = create_transcriber(_cfg(mock_mode="clicks", labels={"kick": "KICK"}), "cpu")
    clicks.load()
    out = clicks.transcribe(make_hits(2.2), SR)
    assert 3 <= len(out.hits_pred) <= 7 and set(out.hits_pred["pad"].tolist()) == {"KICK"}

    flaky = create_transcriber(_cfg(fail_on_call=2), "cpu")
    flaky.load()
    flaky.transcribe(make_tone(0.2), SR)
    with pytest.raises(RuntimeError, match="모의 실패"):
        flaky.transcribe(make_tone(0.2), SR)


def test_load_전에_transcribe하면_오류():
    tr = create_transcriber(_cfg(), "cpu")
    with pytest.raises(RuntimeError, match="load"):
        tr.transcribe(make_tone(0.2), SR)


def test_mock_truth는_파일이_없으면_오류(tmp_path: Path):
    tr = create_transcriber(_cfg(mock_mode="truth", truth_dir=str(tmp_path)), "cpu")
    tr.load()
    with pytest.raises(FileNotFoundError):
        tr.transcribe(make_tone(0.2), SR, song_id="nope")
    with pytest.raises(ValueError, match="mock_mode"):
        create_transcriber(_cfg(mock_mode="nope"), "cpu")


# ---- 도우미 ----


def test_resample과_midi_왕복(tmp_path: Path, synth_song):
    audio = make_tone(1.0)
    out = resample(audio, SR, 24000)
    assert out.shape[0] == 2 and abs(out.shape[1] - 24000) <= 1 and out.dtype == np.float32
    assert resample(audio, SR, SR) is audio

    item, _ = synth_song
    path = hits_to_midi(item.hits_true, tmp_path / "x.mid")
    raw = midi_raw_hits(path)
    assert len(raw) == len(item.hits_true)
    np.testing.assert_allclose([t for t, _, _ in raw], item.hits_true["time_sec"], atol=2e-3)
    assert [p for _, p, _ in raw] == [36, 38, 42]


def test_hits_to_midi는_하이햇_페달을_GM_44로_저장한다(tmp_path: Path):
    # 표에 없으면 킥(36)으로 저장돼 페달 예측이 킥으로 바뀌어 읽힘
    from ssaplash_ai.bench.datasets.pads import make_hits as make_pad_hits

    hits, _ = make_pad_hits(
        [0.1, 0.2], ["HIHAT_PEDAL", "KICK"], None, {"HIHAT_PEDAL": "HIHAT_PEDAL", "KICK": "KICK"}
    )
    raw = midi_raw_hits(hits_to_midi(hits, tmp_path / "pedal.mid"))
    assert [p for _, p, _ in raw] == [44, 36]


def test_hits_to_midi는_타격_간격이_50ms보다_짧아도_저장된다(tmp_path: Path):
    # 앞 음의 note_off(50ms 뒤)가 뒤 음의 note_on보다 늦어도 델타가 음수가 되면 안 됨 (코랩 본측정에서 난 오류)
    from ssaplash_ai.bench.datasets.pads import make_hits as make_pad_hits

    hits, _ = make_pad_hits(
        [0.100, 0.110, 0.120], ["KICK", "SNARE", "HIHAT"], [100, 90, None], IDENTITY
    )
    path = hits_to_midi(hits, tmp_path / "dense.mid")
    raw = midi_raw_hits(path)
    np.testing.assert_allclose([t for t, _, _ in raw], [0.100, 0.110, 0.120], atol=2e-3)
    assert [p for _, p, _ in raw] == [36, 38, 42]
