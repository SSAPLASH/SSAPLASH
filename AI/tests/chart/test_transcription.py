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
from ssaplash_ai.chart.config import TempoConfig, TranscriptionConfig
from ssaplash_ai.chart.errors import ChartInputError, ChartModelError, ChartOutputError
from ssaplash_ai.chart.transcription import CHART_FILENAME, TranscriptionModule

META_KEYS = {
    "chart_json_path",
    "n_notes",
    "notes_by_pad",
    "duration_ms",
    "bpm",
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
