"""분리·채보 설정 읽기, 환경 변수 덮어쓰기, 채보 모델 이름으로 고르기 테스트."""

from __future__ import annotations

from pathlib import Path

import pytest

from ssaplash_ai.chart.config import (
    ENV_CHART_MODEL,
    ENV_DEVICE,
    ENV_WORK_DIR,
    DrumCheckConfig,
    OutputConfig,
    SeparationConfig,
    TempoConfig,
    TranscriptionConfig,
    work_dir_from_env,
)

AI_DIR = Path(__file__).resolve().parents[2]
CONFIG_DIR = AI_DIR / "configs" / "chart"


def test_저장소_설정_파일을_읽는다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_DEVICE, raising=False)
    cfg = SeparationConfig.from_yaml(CONFIG_DIR / "separation.yaml")
    assert cfg.model_config == Path("configs/bench/models/msst/bs_roformer_sw.yaml")
    assert (AI_DIR / cfg.model_config).is_file()
    assert cfg.device == "cuda"
    assert cfg.output == OutputConfig(sample_rate=44100, format="flac")
    assert cfg.max_duration_sec == 600
    assert cfg.source_path == CONFIG_DIR / "separation.yaml"


def test_mock_설정은_cpu와_mock_모델(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_DEVICE, raising=False)
    cfg = SeparationConfig.from_yaml(CONFIG_DIR / "separation_mock.yaml")
    assert cfg.device == "cpu"
    assert cfg.model_config.name == "mock_half.yaml"
    assert (AI_DIR / cfg.model_config).is_file()


def test_기본값(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_DEVICE, raising=False)
    cfg = SeparationConfig.from_dict({"model_config": "m.yaml"})
    assert cfg.model_config == Path("m.yaml") and cfg.device == "cuda"
    assert cfg.output.format == "flac" and cfg.output.sample_rate == 44100
    assert cfg.max_duration_sec == 600.0 and cfg.source_path is None


def test_환경_변수가_장치를_덮어쓴다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(ENV_DEVICE, "cpu")
    cfg = SeparationConfig.from_dict({"model_config": "m.yaml", "device": "cuda"})
    assert cfg.device == "cpu"


@pytest.mark.parametrize(
    "raw, 문구",
    [
        ({}, "model_config"),
        ({"model_config": "m", "extra": 1}, "모르는 분리 설정"),
        ({"model_config": "m", "output": {"format": "mp3"}}, "output.format"),
        ({"model_config": "m", "output": {"bitrate": 1}}, "모르는 output"),
        ({"model_config": "m", "output": {"sample_rate": 0}}, "sample_rate"),
        ({"model_config": "m", "max_duration_sec": 0}, "max_duration_sec"),
    ],
)
def test_잘못된_설정은_ValueError(raw: dict, 문구: str, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_DEVICE, raising=False)
    with pytest.raises(ValueError, match=문구):
        SeparationConfig.from_dict(raw)


def test_빈_yaml은_ValueError(tmp_path: Path):
    (tmp_path / "e.yaml").write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="비어"):
        SeparationConfig.from_yaml(tmp_path / "e.yaml")


def test_work_dir_환경_변수(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.delenv(ENV_WORK_DIR, raising=False)
    assert work_dir_from_env() is None
    monkeypatch.setenv(ENV_WORK_DIR, str(tmp_path / "work"))
    assert work_dir_from_env() == tmp_path / "work"


# ---- 채보 설정 ----


def test_저장소_채보_설정_파일을_읽는다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_DEVICE, raising=False)
    monkeypatch.delenv(ENV_CHART_MODEL, raising=False)
    cfg = TranscriptionConfig.from_yaml(CONFIG_DIR / "transcription.yaml")
    assert cfg.model_name == "strum"
    assert cfg.model_config == Path(
        "configs/bench/transcribers/strum/strum_crnn_songsterr_egmd.yaml"
    )
    assert {"original", "combo", "songsterr_avg", "strum"} <= set(cfg.models)
    assert cfg.models["songsterr_avg"] == Path(
        "configs/bench/transcribers/adtof_drumsep/adtof_drumsep_songsterr_avg.yaml"
    )
    assert cfg.models["original"] == Path(
        "configs/bench/transcribers/adtof_drumsep/adtof_drumsep_ds_ov2.yaml"
    )
    assert all((AI_DIR / p).is_file() for p in cfg.models.values())
    assert cfg.device == "cuda"
    assert cfg.schema_version == 1
    assert cfg.tempo == TempoConfig(
        method="beat_this",
        min_bpm=60,
        max_bpm=200,
        time_signature="4/4",
        origin="notes",
        postprocess="dbn",
        tempo_map=True,
        tempo_map_tolerance_ms=20.0,
        refine=False,
    )
    assert cfg.max_duration_sec == 600


def test_채보_mock_설정은_cpu와_mock_모델(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_DEVICE, raising=False)
    cfg = TranscriptionConfig.from_yaml(CONFIG_DIR / "transcription_mock.yaml")
    assert cfg.device == "cpu"
    assert cfg.model_config.name == "mock_clicks.yaml"
    assert cfg.tempo.method == "librosa"
    assert (AI_DIR / cfg.model_config).is_file()


def test_채보_설정_기본값과_환경_변수(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(ENV_DEVICE, "cpu")
    cfg = TranscriptionConfig.from_dict({"model_config": "m.yaml", "device": "cuda"})
    assert cfg.device == "cpu"
    assert cfg.tempo == TempoConfig()
    assert cfg.schema_version == 1 and cfg.max_duration_sec == 600
    # 채보 가능 검사: 노트 수 기준은 비어 있고(검사 안 함) 박 추적 실패는 실패로 봄
    assert cfg.drum_check == DrumCheckConfig(min_notes_per_minute=None, fail_on_unknown_tempo=True)


def test_저장소_채보_설정은_1분당_노트_수_기준이_켜져_있다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_DEVICE, raising=False)
    monkeypatch.delenv(ENV_CHART_MODEL, raising=False)
    cfg = TranscriptionConfig.from_yaml(CONFIG_DIR / "transcription.yaml")
    # 드럼 있는 곡 179곡 분포에서 1만 곡 중 1곡이 걸리는 값. 드럼 없는 음원 최대는 32.7 (S15P31A307-321 측정)
    assert cfg.drum_check.min_notes_per_minute == 92
    assert cfg.drum_check.fail_on_unknown_tempo is True


def test_drum_check_설정을_읽는다():
    raw = {"model_config": "m.yaml", "drum_check": {"min_notes_per_minute": 12}}
    assert TranscriptionConfig.from_dict(raw).drum_check.min_notes_per_minute == 12.0
    raw = {"model_config": "m.yaml", "drum_check": {"fail_on_unknown_tempo": False}}
    assert TranscriptionConfig.from_dict(raw).drum_check.fail_on_unknown_tempo is False


@pytest.mark.parametrize(
    ("raw", "문구"),
    [
        ({}, "model_config"),
        ({"model_config": "m.yaml", "generator": "x"}, "모르는 채보 설정 필드"),
        ({"model_config": "m.yaml", "schema_version": 2}, "schema_version"),
        ({"model_config": "m.yaml", "max_duration_sec": 0}, "max_duration_sec"),
        ({"model_config": "m.yaml", "tempo": {"method": "madmom"}}, "tempo.method"),
        ({"model_config": "m.yaml", "tempo": {"min_bpm": 80, "max_bpm": 150}}, "tempo 범위"),
        ({"model_config": "m.yaml", "tempo": {"time_signature": "4-4"}}, "time_signature"),
        ({"model_config": "m.yaml", "tempo": {"bpm": 120}}, "모르는 tempo 필드"),
        ({"model_config": "m.yaml", "tempo": {"origin": "first_beat"}}, "tempo.origin"),
        ({"model_config": "m.yaml", "tempo": {"postprocess": "hmm"}}, "tempo.postprocess"),
        ({"model_config": "m.yaml", "tempo": {"tempo_map": "yes"}}, "tempo.tempo_map"),
        (
            {"model_config": "m.yaml", "tempo": {"tempo_map_tolerance_ms": 0}},
            "tempo_map_tolerance_ms",
        ),
        ({"model_config": "m.yaml", "drum_check": {"min_notes": 3}}, "모르는 drum_check 필드"),
        (
            {"model_config": "m.yaml", "drum_check": {"min_notes_per_minute": 0}},
            "min_notes_per_minute",
        ),
        (
            {"model_config": "m.yaml", "drum_check": {"fail_on_unknown_tempo": "yes"}},
            "fail_on_unknown_tempo",
        ),
    ],
)
def test_잘못된_채보_설정은_ValueError(raw: dict, 문구: str):
    with pytest.raises(ValueError, match=문구):
        TranscriptionConfig.from_dict(raw)


# ---- 채보 모델 이름으로 고르기 ----

MODELS_RAW = {"model": "original", "models": {"original": "a.yaml", "combo": "b.yaml"}}


def test_채보_모델을_이름으로_고른다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_CHART_MODEL, raising=False)
    cfg = TranscriptionConfig.from_dict(MODELS_RAW)
    assert (cfg.model_name, cfg.model_config) == ("original", Path("a.yaml"))
    cfg = TranscriptionConfig.from_dict({**MODELS_RAW, "model": "combo"})
    assert (cfg.model_name, cfg.model_config) == ("combo", Path("b.yaml"))


def test_채보_모델_환경_변수가_우선(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(ENV_CHART_MODEL, "combo")
    assert TranscriptionConfig.from_dict(MODELS_RAW).model_config == Path("b.yaml")


def test_채보_모델_이름_오류(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_CHART_MODEL, raising=False)
    with pytest.raises(ValueError, match="모르는 채보 모델 이름"):
        TranscriptionConfig.from_dict({**MODELS_RAW, "model": "nope"})
    with pytest.raises(ValueError, match="model"):
        TranscriptionConfig.from_dict({"models": MODELS_RAW["models"]})
    with pytest.raises(ValueError, match="같이 쓸 수 없음"):
        TranscriptionConfig.from_dict({**MODELS_RAW, "model_config": "c.yaml"})


def test_옛_형식_model_config도_받는다(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ENV_CHART_MODEL, raising=False)
    cfg = TranscriptionConfig.from_dict({"model_config": "c.yaml"})
    assert (cfg.model_name, cfg.model_config) == (None, Path("c.yaml"))
