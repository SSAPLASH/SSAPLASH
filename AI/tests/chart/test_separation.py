"""분리 모듈 테스트. mock 어댑터(모델 없음)와 테스트가 직접 만드는 짧은 소리 파일만 사용.

설계 인수 조건 2(반주 + 드럼 = 원곡, 샘플 수 같음), 4(입력 오류는 모델을 안 돌림), 8(모델 다운로드 없이 전체 흐름).
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from helpers import SR, make_tone, write_wav
from ssaplash_ai.bench.separators import SeparatorConfig
from ssaplash_ai.chart import separation as separation_module
from ssaplash_ai.chart.config import OutputConfig, SeparationConfig
from ssaplash_ai.chart.errors import ChartInputError, ChartModelError
from ssaplash_ai.chart.separation import (
    AUDIO_TIME_ORIGIN,
    DURATION_TOLERANCE_MS,
    SeparationModule,
    SeparationOutput,
    headroom_gain,
    target_samples,
)

META_KEYS = {
    "drum_stem_path",
    "accompaniment_path",
    "duration_ms",
    "sample_rate",
    "model_name",
    "model_version",
    "load_ms",
    "separate_ms",
    "peak_vram_mb",
    "peak_ram_mb",
    "audio_time_origin",
    "drums_gain_db",
    "accompaniment_limit_db",
}


def _mock_model_yaml(
    path: Path, mode: str = "half", fail_on_call: int | None = None, adapter: str = "mock"
) -> Path:
    lines = [
        "name: mock_half",
        f"adapter: {adapter}",
        f"mock_mode: {mode}",
        "license_code: x",
        "license_weights: y",
    ]
    if fail_on_call is not None:
        lines.append(f"fail_on_call: {fail_on_call}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _config(
    tmp_path: Path, fmt: str = "flac", max_duration_sec: float = 10.0, **model_kw
) -> SeparationConfig:
    model_yaml = _mock_model_yaml(tmp_path / "mock.yaml", **model_kw)
    return SeparationConfig(
        model_config=model_yaml,
        device="cpu",
        output=OutputConfig(format=fmt),
        max_duration_sec=max_duration_sec,
    )


def _song(tmp_path: Path, seconds: float = 1.0) -> tuple[Path, np.ndarray]:
    """좌우가 다른 1초 소리 파일."""
    left = make_tone(seconds, SR, 220.0)[0]
    right = make_tone(seconds, SR, 330.0)[0]
    audio = np.stack([left, right])
    path = tmp_path / "song.wav"
    write_wav(path, audio)
    return path, audio


def _read(path: Path) -> np.ndarray:
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    assert sr == SR
    return data.T


@pytest.fixture
def module(tmp_path: Path) -> Iterator[SeparationModule]:
    m = SeparationModule(_config(tmp_path))
    m.load()
    yield m
    m.close()


def test_세_파일의_샘플_수가_같고_반주_더하기_드럼이_원곡(tmp_path: Path, module: SeparationModule):
    song, audio = _song(tmp_path)
    out = module.separate_file(song, tmp_path / "out")
    drums = _read(out.drum_stem_path)
    accomp = _read(out.accompaniment_path)
    mixture = _read(song)
    assert drums.shape == accomp.shape == mixture.shape == audio.shape
    assert float(np.max(np.abs(drums + accomp - mixture))) < 1e-4
    np.testing.assert_allclose(drums, 0.5 * mixture, atol=1e-4)


def test_결과_메타(tmp_path: Path, module: SeparationModule):
    song, _ = _song(tmp_path, 1.0)
    out = module.separate_file(song, tmp_path / "out")
    assert isinstance(out, SeparationOutput)
    assert out.drum_stem_path == tmp_path / "out" / "drums.flac"
    assert out.accompaniment_path == tmp_path / "out" / "accompaniment.flac"
    assert out.duration_ms == 1000 and out.sample_rate == SR
    assert out.model_name == "mock_half"
    assert re.fullmatch(r"mock:half@[0-9a-f]{12}", out.model_version)
    assert out.load_ms >= 0 and out.separate_ms >= 0
    assert out.peak_vram_mb is None  # cpu
    assert out.peak_ram_mb is not None and out.peak_ram_mb > 0
    assert out.audio_time_origin == AUDIO_TIME_ORIGIN == "SOURCE_START"
    assert out.drums_gain_db == 0.0 and out.accompaniment_limit_db == 0.0  # 작은 소리라 줄이지 않음
    d = out.to_dict()
    assert set(d) == META_KEYS
    assert d["drum_stem_path"] == str(out.drum_stem_path)
    assert d["accompaniment_path"] == str(out.accompaniment_path)


def test_진행_콜백은_단계마다_시작과_끝(tmp_path: Path, module: SeparationModule):
    song, _ = _song(tmp_path)
    calls: list[tuple[str, float]] = []
    module.separate_file(song, tmp_path / "out", on_progress=lambda s, f: calls.append((s, f)))
    assert calls == [
        ("LOAD_INPUT", 0.0),
        ("LOAD_INPUT", 1.0),
        ("SEPARATE", 0.0),
        ("SEPARATE", 1.0),
        ("WRITE", 0.0),
        ("WRITE", 1.0),
    ]


def test_같은_입력을_두_번_넣으면_같은_파일(tmp_path: Path, module: SeparationModule):
    song, _ = _song(tmp_path)
    a = module.separate_file(song, tmp_path / "out1")
    b = module.separate_file(song, tmp_path / "out2")
    np.testing.assert_array_equal(_read(a.drum_stem_path), _read(b.drum_stem_path))
    np.testing.assert_array_equal(_read(a.accompaniment_path), _read(b.accompaniment_path))
    assert a.duration_ms == b.duration_ms and a.model_version == b.model_version


def test_입력_오류면_모델을_돌리지_않는다(tmp_path: Path):
    m = SeparationModule(_config(tmp_path, fail_on_call=1))
    m.load()
    silent = tmp_path / "silent.wav"
    write_wav(silent, np.zeros((2, SR), dtype=np.float32))
    with pytest.raises(ChartInputError) as info:
        m.separate_file(silent, tmp_path / "out")
    assert info.value.code == "INPUT_INVALID" and info.value.retryable is False
    assert m._separator.calls == 0
    assert not (tmp_path / "out").exists()
    m.close()


def test_길이_상한을_넘으면_입력_오류(tmp_path: Path):
    m = SeparationModule(_config(tmp_path, max_duration_sec=0.5))
    m.load()
    song, _ = _song(tmp_path, 1.0)
    with pytest.raises(ChartInputError, match="너무 긺"):
        m.separate_file(song, tmp_path / "out")
    assert m._separator.calls == 0
    m.close()


def test_모델_예외는_ChartModelError로_감싼다(tmp_path: Path):
    m = SeparationModule(_config(tmp_path, fail_on_call=1))
    m.load()
    song, _ = _song(tmp_path)
    with pytest.raises(ChartModelError) as info:
        m.separate_file(song, tmp_path / "out")
    e = info.value
    assert e.code == "MODEL_FAILED" and e.retryable is False
    assert "RuntimeError" in e.message and "모의 실패" in e.message
    assert isinstance(e.__cause__, RuntimeError)
    assert not (tmp_path / "out").exists()
    m.close()


def test_GPU_메모리_부족은_재시도_가능(
    tmp_path: Path, module: SeparationModule, monkeypatch: pytest.MonkeyPatch
):
    def boom(mixture, sample_rate):
        raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")

    monkeypatch.setattr(module._separator, "_separate", boom)
    song, _ = _song(tmp_path)
    with pytest.raises(ChartModelError) as info:
        module.separate_file(song, tmp_path / "out")
    assert info.value.retryable is True
    assert "메모리 부족" in info.value.message


def test_load_전에는_separate_file_못_함(tmp_path: Path):
    m = SeparationModule(_config(tmp_path))
    assert not m.loaded
    song, _ = _song(tmp_path)
    with pytest.raises(ChartModelError, match="load"):
        m.separate_file(song, tmp_path / "out")
    m.close()  # load 전에 불러도 됨


def test_모델_설정이_없으면_ChartModelError(tmp_path: Path):
    cfg = SeparationConfig(model_config=tmp_path / "없음.yaml", device="cpu")
    with pytest.raises(ChartModelError, match="모델 설정"):
        SeparationModule(cfg).load()


def test_모르는_어댑터도_ChartModelError(tmp_path: Path):
    cfg = _config(tmp_path, adapter="nope")
    with pytest.raises(ChartModelError, match="모델 설정"):
        SeparationModule(cfg).load()


def test_cuda를_못_쓰면_cpu로_내려간다(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(separation_module, "cuda_available", lambda device: False)
    assert SeparationModule(_config(tmp_path), device="cuda").device == "cpu"
    monkeypatch.setattr(separation_module, "cuda_available", lambda device: True)
    assert SeparationModule(_config(tmp_path), device="cuda").device == "cuda"
    assert SeparationModule(_config(tmp_path)).device == "cpu"  # 설정값 cpu


def test_wav_출력_형식(tmp_path: Path):
    m = SeparationModule(_config(tmp_path, fmt="wav"))
    m.load()
    song, _ = _song(tmp_path)
    out = m.separate_file(song, tmp_path / "out")
    assert out.drum_stem_path.name == "drums.wav"
    assert out.accompaniment_path.name == "accompaniment.wav"
    info = sf.info(str(out.drum_stem_path))
    assert info.format == "WAV" and info.subtype == "PCM_16"
    m.close()


def test_close_뒤에는_다시_load(tmp_path: Path):
    m = SeparationModule(_config(tmp_path))
    m.load()
    m.close()
    assert not m.loaded
    m.load()
    assert m.loaded
    m.close()


# ---- 원곡 길이 맞추기 ----


def test_duration_ms를_주면_끝에_무음을_채우고_메타도_그_값(
    tmp_path: Path, module: SeparationModule
):
    song, audio = _song(tmp_path, 1.0)  # 44100 샘플
    out = module.separate_file(song, tmp_path / "out", duration_ms=1020)
    n = 1020 * SR // 1000  # 44982
    drums = _read(out.drum_stem_path)
    accomp = _read(out.accompaniment_path)
    assert drums.shape == accomp.shape == (2, n)
    assert out.duration_ms == 1020
    np.testing.assert_allclose(drums[:, : audio.shape[1]], 0.5 * audio, atol=1e-4)
    assert float(np.max(np.abs(drums[:, audio.shape[1] :]))) == 0.0
    assert float(np.max(np.abs(accomp[:, audio.shape[1] :]))) == 0.0


def test_duration_ms가_짧으면_끝을_잘라낸다(tmp_path: Path, module: SeparationModule):
    song, _ = _song(tmp_path, 1.0)
    out = module.separate_file(song, tmp_path / "out", duration_ms=990)
    n = 990 * SR // 1000  # 43659
    assert sf.info(str(out.drum_stem_path)).frames == n
    assert sf.info(str(out.accompaniment_path)).frames == n
    assert out.duration_ms == 990


def test_duration_ms가_실측과_허용_차이를_넘으면_입력_오류_모델_안_돌림(tmp_path: Path):
    m = SeparationModule(_config(tmp_path, fail_on_call=1))
    m.load()
    song, _ = _song(tmp_path, 1.0)
    with pytest.raises(ChartInputError, match="배정 값과 다름") as info:
        m.separate_file(song, tmp_path / "out", duration_ms=1000 + DURATION_TOLERANCE_MS + 1)
    assert info.value.code == "INPUT_INVALID"
    assert m._separator.calls == 0
    with pytest.raises(ChartInputError, match="양수"):
        m.separate_file(song, tmp_path / "out", duration_ms=0)
    assert m._separator.calls == 0
    m.close()


def test_출력_샘플_수를_ms로_올림하면_항상_원곡_길이와_같다():
    """BE는 ffprobe 길이(초)를 ms로 올림해 원곡 길이 D와 비교함. 1ms~600초 전부 검사."""
    for d in range(1, 600_001):
        n = target_samples(d, d, SR)
        assert -(-n * 1000 // SR) == d, d  # 정수 올림
    assert target_samples(1000, 1012, SR) == 44100  # 허용 차이 안이면 배정 값 기준


def test_가중치_폴더_환경_변수(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    cfg = SeparatorConfig.from_dict(
        {"name": "m", "adapter": "mock", "license_code": "x", "license_weights": "y"}
    )
    monkeypatch.delenv("SSAPLASH_MODELS_DIR", raising=False)
    assert cfg.model_dir == Path("data/models") / "m"
    monkeypatch.setenv("SSAPLASH_MODELS_DIR", str(tmp_path / "weights"))
    assert cfg.model_dir == tmp_path / "weights" / "m"


def test_피크가_0dB를_넘는_원곡도_잘리지_않고_반주는_넘는_곳만_누른다(tmp_path: Path):
    # 크게 마스터링된 곡처럼 앞 0.5초만 피크 2.4, 뒤 1.5초는 0.4인 원곡. mock이 절반씩 나눠 앞부분은 두 파일 모두
    # 피크 1.2라 그대로 저장하면 잘림
    song, audio = _song(tmp_path, 2.0)
    loud = (audio / np.max(np.abs(audio)) * 0.4).astype(np.float32)
    loud[:, : SR // 2] *= 6.0
    sf.write(str(song), loud.T, SR, subtype="FLOAT")
    m = SeparationModule(_config(tmp_path))
    m.load()
    out = m.separate_file(song, tmp_path / "out")
    m.close()
    drums, accomp = _read(out.drum_stem_path), _read(out.accompaniment_path)
    limit = 10 ** (-1 / 20)
    assert max(np.max(np.abs(drums)), np.max(np.abs(accomp))) <= limit + 1e-3
    # 드럼 파일은 전체에 이득 하나
    assert out.drums_gain_db == pytest.approx(20 * np.log10(limit / 1.2), abs=0.01)
    np.testing.assert_allclose(drums, 0.5 * loud * 10 ** (out.drums_gain_db / 20), atol=1e-3)
    # 반주는 큰 소리가 끝나고 1초 지난 곳부터 원래 음량 그대로
    assert out.accompaniment_limit_db < 0
    tail = slice(int(1.5 * SR), None)
    np.testing.assert_allclose(accomp[:, tail], 0.5 * loud[:, tail], atol=1e-3)


def test_headroom_gain은_상한_아래면_1():
    x = np.full((2, 10), 0.5, dtype=np.float32)
    assert headroom_gain(x, x) == 1.0
    assert headroom_gain(x * 4) == pytest.approx(10 ** (-1 / 20) / 2.0)
