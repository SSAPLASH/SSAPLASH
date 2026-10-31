"""bpm 추정 테스트. 테스트가 만드는 일정 간격 타격 소리와 로컬 파일만 사용(네트워크 없음).

Beat This! 실제 모델 테스트는 beat_this 패키지와 가중치(SSAPLASH_MODELS_DIR/beat_this/)가 있을 때만 돎.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_hits
from ssaplash_ai.chart import tempo as tempo_module
from ssaplash_ai.chart.config import ENV_MODELS_DIR, TempoConfig
from ssaplash_ai.chart.tempo import (
    FALLBACK_BPM,
    BeatThisTempo,
    LibrosaTempo,
    bpm_from_beats,
    create_tempo_estimator,
    ensure_beat_this_checkpoint,
    estimate_from_beats,
    fold_bpm,
    models_dir,
)

LIBROSA = TempoConfig(method="librosa")


def _clicks(bpm: float, seconds: float = 20.0, start: float = 0.5) -> np.ndarray:
    interval = 60.0 / bpm
    times = list(np.arange(start, seconds - 0.2, interval))
    return make_hits(seconds, times)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(120.0, 120.0), (50.0, 100.0), (25.0, 100.0), (240.0, 120.0), (420.0, 105.0), (60.0, 60.0)],
)
def test_범위_밖은_2배_절반으로_접음(raw: float, expected: float):
    assert fold_bpm(raw, 60.0, 200.0) == pytest.approx(expected)


def test_박_간격_계산은_튀는_간격을_뺌():
    beats = np.array([0.0, 0.5, 1.0, 1.5, 2.5, 3.0, 3.5])  # 2.0초 박 하나를 건너뜀
    assert bpm_from_beats(beats) == pytest.approx(120.0)
    assert bpm_from_beats(np.array([0.0, 0.5])) is None


def test_박_시각에서_결과를_만듦():
    beats = np.arange(0.25, 10.0, 0.25)  # 240bpm → 120으로 접힘
    est = estimate_from_beats(beats, np.array([1.25, 3.25]), TempoConfig(), "beat_this")
    assert est.estimated and est.bpm == 120.0 and est.raw_bpm == 240.0
    assert est.first_beat_ms == 250 and est.first_downbeat_ms == 1250
    assert est.n_beats == beats.size and est.method == "beat_this"


def test_박이_모자라면_힌트_그것도_없으면_기본값():
    few = np.array([1.0, 1.5])
    hinted = estimate_from_beats(few, None, TempoConfig(), "librosa", hint_bpm=95.0)
    assert hinted.estimated and hinted.bpm == 95.0
    none = estimate_from_beats(np.array([]), None, TempoConfig(), "librosa")
    assert not none.estimated and none.bpm == FALLBACK_BPM and none.raw_bpm is None
    assert none.first_beat_ms is None and none.first_downbeat_ms is None


@pytest.mark.parametrize("bpm", [87.0, 90.0, 120.0, 128.0, 150.0])
def test_librosa_일정_간격_타격은_0점5퍼센트_안으로(bpm: float):
    est = LibrosaTempo(LIBROSA).estimate(_clicks(bpm), SR)
    assert est.estimated and est.method == "librosa"
    assert est.bpm == pytest.approx(bpm, rel=0.005)
    assert est.n_beats > 10 and est.time_signature == "4/4"
    assert est.first_downbeat_ms is None
    # 첫 박은 타격 위치 중 하나 (librosa가 앞쪽 약한 박을 잘라 0.5초보다 늦을 수 있음)
    interval_ms = 60_000 / bpm
    offset = (est.first_beat_ms - 500) % interval_ms
    assert min(offset, interval_ms - offset) < 30


def test_librosa_무음이면_기본값():
    est = LibrosaTempo(LIBROSA).estimate(np.zeros((2, SR * 3), dtype=np.float32), SR)
    assert not est.estimated and est.bpm == FALLBACK_BPM


def test_방법에_맞는_추정기를_만듦():
    assert isinstance(create_tempo_estimator(LIBROSA), LibrosaTempo)
    assert isinstance(create_tempo_estimator(TempoConfig()), BeatThisTempo)
    assert create_tempo_estimator(LIBROSA).version_id == "librosa"
    assert BeatThisTempo(TempoConfig()).version_id.startswith("beat_this:final0:")


def test_load_전에_estimate하면_오류():
    with pytest.raises(RuntimeError, match="load"):
        BeatThisTempo(TempoConfig()).estimate(np.zeros((2, SR)), SR)


# ---- 가중치 받기·md5 확인 (file:// 주소로 네트워크 없이) ----


def _fake_weights(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, content: bytes) -> str:
    source = tmp_path / "src" / "beat_this-final0.ckpt"
    source.parent.mkdir()
    source.write_bytes(content)
    monkeypatch.setitem(tempo_module.BEAT_THIS_MD5, "final0", hashlib.md5(content).hexdigest())
    return source.as_uri().replace("beat_this-final0.ckpt", "beat_this-{name}.ckpt")


def test_가중치가_없으면_받아서_md5_확인(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    good = _fake_weights(tmp_path, monkeypatch, b"weights")
    missing = (tmp_path / "없음" / "{name}.ckpt").as_uri()
    path = ensure_beat_this_checkpoint(directory=tmp_path / "models", urls=(missing, good))
    assert path == tmp_path / "models" / "beat_this-final0.ckpt"
    assert path.read_bytes() == b"weights"
    assert not path.with_suffix(".part").exists()


def test_md5가_맞는_파일이_있으면_안_받음(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _fake_weights(tmp_path, monkeypatch, b"weights")
    target = tmp_path / "models" / "beat_this-final0.ckpt"
    target.parent.mkdir()
    target.write_bytes(b"weights")
    assert ensure_beat_this_checkpoint(directory=target.parent, urls=()) == target


def test_md5가_다르면_오류이고_파일을_안_남김(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    url = _fake_weights(tmp_path, monkeypatch, b"weights")
    monkeypatch.setitem(tempo_module.BEAT_THIS_MD5, "final0", "0" * 32)
    with pytest.raises(RuntimeError, match="md5 불일치"):
        ensure_beat_this_checkpoint(directory=tmp_path / "models", urls=(url,))
    assert list((tmp_path / "models").iterdir()) == []


def test_가중치_폴더는_환경_변수(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.delenv(ENV_MODELS_DIR, raising=False)
    assert models_dir() == Path("data/models")
    monkeypatch.setenv(ENV_MODELS_DIR, str(tmp_path))
    assert models_dir() == tmp_path


# ---- Beat This! 실제 모델 (패키지·가중치가 있을 때만) ----


def _beat_this_ready() -> bool:
    try:
        import beat_this.inference  # noqa: F401
    except ImportError:
        return False
    return (models_dir() / "beat_this" / "beat_this-final0.ckpt").is_file()


@pytest.mark.skipif(not _beat_this_ready(), reason="beat_this 패키지나 가중치 없음")
@pytest.mark.parametrize("bpm", [90.0, 120.0])
def test_beat_this_일정_간격_타격(bpm: float):
    estimator = BeatThisTempo(TempoConfig(), device="cpu")
    estimator.load()
    est = estimator.estimate(_clicks(bpm), SR)
    estimator.close()
    assert est.estimated and est.method == "beat_this"
    assert est.bpm == pytest.approx(bpm, rel=0.01)
