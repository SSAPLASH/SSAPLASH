"""채보 모듈 테스트. mock 어댑터(clicks: 온셋 검출로 시각만 찾음)와 테스트가 만드는 짧은 드럼 소리만 사용.

설계 인수 조건 6(JSON 검증 통과), 7(같은 입력이면 같은 JSON), 8(모델 다운로드 없이 전체 흐름).
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from helpers import HITS, SR, make_hits, write_wav
from ssaplash_ai.chart import transcription as transcription_module
from ssaplash_ai.chart.chart_json import validate_chart
from ssaplash_ai.chart.config import DrumCheckConfig, TempoConfig, TranscriptionConfig
from ssaplash_ai.chart.errors import (
    ChartInputError,
    ChartModelError,
    ChartNotTranscribableError,
    ChartOutputError,
)
from ssaplash_ai.chart.tempo import TempoEstimate
from ssaplash_ai.chart.transcription import (
    CHART_FILENAME,
    TranscriptionModule,
    check_transcribable,
)

META_KEYS = {
    "chart_json_path",
    "n_notes",
    "notes_by_pad",
    "duration_ms",
    "bpm",
    "tracked_bpm",
    "timing_refine",
    "raw_bpm",
    "first_beat_ms",
    "first_downbeat_ms",
    "bpm_estimated",
    "bpm_method",
    "model_name",
    "model_version",
    "load_ms",
    "transcribe_ms",
    "peak_vram_mb",
    "peak_ram_mb",
    "downbeat_phase_ms",
    "beat_source",
    "tempo_segments",
}


def _mock_model_yaml(
    path: Path, label: str = "KICK", fail_on_call: int | None = None, mode: str = "clicks"
) -> Path:
    lines = [
        "name: mock_clicks",
        "adapter: mock",
        f"mock_mode: {mode}",
        "license_code: x",
        "license_weights: y",
        "labels:",
        f"  kick: {label}",
    ]
    if fail_on_call is not None:
        lines.append(f"fail_on_call: {fail_on_call}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _config(tmp_path: Path, **model_kw) -> TranscriptionConfig:
    return TranscriptionConfig(
        model_config=_mock_model_yaml(tmp_path / "mock.yaml", **model_kw),
        device="cpu",
        tempo=TempoConfig(method="librosa"),
        max_duration_sec=10.0,
    )


def _drums(tmp_path: Path, seconds: float = 2.2) -> Path:
    path = tmp_path / "drums.wav"
    write_wav(path, make_hits(seconds))
    return path


def _module(config: TranscriptionConfig) -> TranscriptionModule:
    module = TranscriptionModule(config)
    module.load()
    return module


def test_원곡을_주면_박을_원곡으로_찾고_못_읽으면_드럼_트랙(tmp_path: Path):
    # 설계 CHART-003-variable-tempo-exp 인수 조건 4
    module = _module(_config(tmp_path))
    mix = tmp_path / "mix.wav"
    write_wav(mix, make_hits(2.2))
    with_mix = module.transcribe_file(_drums(tmp_path), tmp_path / "a", beat_audio_path=mix)
    assert with_mix.beat_source == "mix"
    missing = module.transcribe_file(
        _drums(tmp_path), tmp_path / "b", beat_audio_path=tmp_path / "없음.wav"
    )
    assert missing.beat_source == "drums"
    assert module.transcribe_file(_drums(tmp_path), tmp_path / "c").beat_source == "drums"
    module.close()


def test_드럼_트랙에서_채보_JSON과_메타(tmp_path: Path):
    module = _module(_config(tmp_path))
    out = module.transcribe_file(_drums(tmp_path), tmp_path / "out")

    assert out.chart_json_path == tmp_path / "out" / CHART_FILENAME
    saved = json.loads(out.chart_json_path.read_text(encoding="utf-8"))
    assert saved == out.chart
    validate_chart(saved, out.duration_ms)
    assert out.duration_ms == 2200
    times = [n["timeMs"] for n in saved["charts"][0]["notes"]]
    # 온셋 검출 시각이 실제 타격과 30ms 안
    assert len(times) == len(HITS)
    assert all(abs(t - h * 1000) < 30 for t, h in zip(times, HITS, strict=True))
    assert out.n_notes == len(HITS) and out.notes_by_pad["KICK"] == len(HITS)
    assert saved["metrics"] == {"transcribeMs": out.transcribe_ms, "durationMs": 2200}
    assert saved["charts"][0]["timing"]["bpm"] == out.bpm > 0
    # librosa는 마디 첫 박이 없어 첫 박 시각이 격자 원점
    assert saved["charts"][0]["timing"]["offsetMs"] == out.first_beat_ms

    assert out.model_name == "mock_clicks"
    assert re.fullmatch(r"mock_clicks@[0-9a-f]{12}", out.model_version)
    assert out.bpm_method == "librosa"
    assert saved["generator"] == "ADT_MODEL" and saved["generatorVersion"] == out.model_version
    assert out.peak_vram_mb is None
    meta = out.to_dict()
    assert set(meta) == META_KEYS
    json.dumps(meta)
    module.close()


def test_같은_입력이면_같은_JSON(tmp_path: Path):
    module = _module(_config(tmp_path))
    drums = _drums(tmp_path)
    a = module.transcribe_file(drums, tmp_path / "a").chart
    b = module.transcribe_file(drums, tmp_path / "b").chart
    a["metrics"].pop("transcribeMs")
    b["metrics"].pop("transcribeMs")
    assert a == b


def test_시각_규칙_버전이_바뀌면_generatorVersion도_바뀜(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    module = _module(_config(tmp_path))
    current = module.model_version
    monkeypatch.setattr(transcription_module, "TIMING_RULES_VERSION", "timing1")
    assert module.model_version != current
    assert module.model_version.split("@")[0] == current.split("@")[0]


def test_원점_방식이_바뀌면_generatorVersion도_바뀜(tmp_path: Path):
    config = _config(tmp_path)
    downbeat = _module(config).model_version
    config.tempo = replace(config.tempo, origin="notes")
    notes = _module(config).model_version
    assert notes != downbeat
    assert notes.split("@")[0] == downbeat.split("@")[0]


def test_원곡_길이를_주면_그_값을_씀(tmp_path: Path):
    module = _module(_config(tmp_path))
    out = module.transcribe_file(_drums(tmp_path), tmp_path / "out", duration_ms=1500)
    assert out.duration_ms == 1500 and out.chart["metrics"]["durationMs"] == 1500
    assert all(n["timeMs"] <= 1500 for n in out.chart["charts"][0]["notes"])


def test_진행_콜백_순서(tmp_path: Path):
    module = _module(_config(tmp_path))
    calls: list[tuple[str, float]] = []
    module.transcribe_file(
        _drums(tmp_path), tmp_path / "out", on_progress=lambda s, f: calls.append((s, f))
    )
    assert calls == [
        ("LOAD_INPUT", 0.0),
        ("LOAD_INPUT", 1.0),
        ("TRANSCRIBE", 0.0),
        ("TRANSCRIBE", 1.0),
        ("JSON", 0.0),
        ("JSON", 1.0),
    ]


def test_입력_오류는_모델을_안_돌림(tmp_path: Path):
    module = _module(_config(tmp_path, fail_on_call=1))
    silent = tmp_path / "silent.wav"
    write_wav(silent, np.zeros((2, SR), dtype=np.float32))
    with pytest.raises(ChartInputError):
        module.transcribe_file(silent, tmp_path / "out")
    with pytest.raises(ChartInputError):
        module.transcribe_file(tmp_path / "없음.wav", tmp_path / "out")
    assert module._transcriber.calls == 0


def test_드럼_트랙이_무음이면_채보_불가(tmp_path: Path):
    module = _module(_config(tmp_path))
    silent = tmp_path / "silent.wav"
    write_wav(silent, np.zeros((2, SR), dtype=np.float32))
    with pytest.raises(ChartNotTranscribableError, match="드럼 트랙 무음") as info:
        module.transcribe_file(silent, tmp_path / "out")
    assert info.value.reason == "NOT_TRANSCRIBABLE" and info.value.code == "INPUT_INVALID"
    assert module._transcriber.calls == 0


def test_노트_수_기준이_비어_있으면_노트_수로는_실패하지_않는다(tmp_path: Path):
    config = _config(tmp_path)
    assert config.drum_check.min_notes_per_minute is None
    out = _module(config).transcribe_file(_drums(tmp_path), tmp_path / "out")
    assert out.n_notes == len(HITS)


def test_1분당_노트_수가_기준_미만이면_채보_불가이고_파일을_안_남김(tmp_path: Path):
    config = replace(_config(tmp_path), drum_check=DrumCheckConfig(min_notes_per_minute=10_000))
    with pytest.raises(ChartNotTranscribableError, match="1분당 노트 .*기준 10000개"):
        _module(config).transcribe_file(_drums(tmp_path), tmp_path / "out")
    assert not (tmp_path / "out" / CHART_FILENAME).exists()


def test_1분당_노트_수가_기준_이상이면_통과(tmp_path: Path):
    config = replace(_config(tmp_path), drum_check=DrumCheckConfig(min_notes_per_minute=1))
    out = _module(config).transcribe_file(_drums(tmp_path), tmp_path / "out")
    assert out.n_notes == len(HITS) and (tmp_path / "out" / CHART_FILENAME).is_file()


def _tempo_fails(module: TranscriptionModule, monkeypatch: pytest.MonkeyPatch) -> None:
    original = module._tempo.estimate

    def failed(audio, sample_rate):
        return replace(original(audio, sample_rate), estimated=False, bpm=120.0)

    monkeypatch.setattr(module._tempo, "estimate", failed)


def test_박_추적_실패면_채보_불가(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    module = _module(_config(tmp_path))
    _tempo_fails(module, monkeypatch)
    with pytest.raises(ChartNotTranscribableError, match="박 추적 실패, 박 [0-9]+개"):
        module.transcribe_file(_drums(tmp_path), tmp_path / "out")
    assert not (tmp_path / "out" / CHART_FILENAME).exists()


def test_fail_on_unknown_tempo가_거짓이면_박_추적_실패도_통과(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    config = replace(_config(tmp_path), drum_check=DrumCheckConfig(fail_on_unknown_tempo=False))
    module = _module(config)
    _tempo_fails(module, monkeypatch)
    out = module.transcribe_file(_drums(tmp_path), tmp_path / "out")
    assert out.bpm_estimated is False


def test_노트_수를_박_추적보다_먼저_본다():
    tempo = TempoEstimate(
        bpm=120.0,
        raw_bpm=None,
        first_beat_ms=None,
        first_downbeat_ms=None,
        n_beats=0,
        time_signature="4/4",
        estimated=False,
        method="librosa",
    )
    with pytest.raises(ChartNotTranscribableError, match="1분당 노트 3.0개, 기준 5개"):
        check_transcribable(3, 60_000, tempo, DrumCheckConfig(min_notes_per_minute=5))
    with pytest.raises(ChartNotTranscribableError, match="박 추적 실패, 박 0개"):
        check_transcribable(5, 60_000, tempo, DrumCheckConfig(min_notes_per_minute=5))
    check_transcribable(5, 60_000, replace(tempo, estimated=True), DrumCheckConfig(5))


def test_모델_예외는_모델_오류로_감쌈(tmp_path: Path):
    module = _module(_config(tmp_path, fail_on_call=1))
    with pytest.raises(ChartModelError, match="채보 실패: RuntimeError") as info:
        module.transcribe_file(_drums(tmp_path), tmp_path / "out")
    assert not info.value.retryable
    assert not (tmp_path / "out" / CHART_FILENAME).exists()


def test_패드_9종이_아니면_출력_오류이고_파일을_안_남김(tmp_path: Path):
    module = _module(_config(tmp_path, label="tom"))
    with pytest.raises(ChartOutputError, match="패드 9종 밖"):
        module.transcribe_file(_drums(tmp_path), tmp_path / "out")
    assert not (tmp_path / "out" / CHART_FILENAME).exists()


def test_모델_설정이_없으면_모델_오류(tmp_path: Path):
    config = TranscriptionConfig(model_config=tmp_path / "없음.yaml", device="cpu")
    with pytest.raises(ChartModelError, match="모델 설정을 읽지 못함"):
        TranscriptionModule(config).load()


def test_load_전에_부르면_모델_오류(tmp_path: Path):
    module = TranscriptionModule(_config(tmp_path))
    with pytest.raises(ChartModelError, match="load"):
        module.transcribe_file(_drums(tmp_path), tmp_path / "out")
    module.close()


def test_노래_파일_채보는_페달을_하이햇으로_합침(tmp_path: Path):
    module = _module(_config(tmp_path, label="HIHAT_PEDAL"))
    out = module.transcribe_file(_drums(tmp_path), tmp_path / "out")
    pads = {n["pad"] for n in out.chart["charts"][0]["notes"]}
    assert pads == {"HIHAT"}
    assert out.notes_by_pad["HIHAT"] == len(HITS) and out.notes_by_pad["HIHAT_PEDAL"] == 0
