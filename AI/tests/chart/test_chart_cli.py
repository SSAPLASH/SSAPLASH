"""ssaplash-chart separate 명령 테스트. mock 모델과 테스트가 직접 만드는 짧은 소리 파일만 사용."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from helpers import SR, make_tone, write_wav
from ssaplash_ai.chart.cli import main
from ssaplash_ai.chart.config import ENV_DEVICE, ENV_WORK_DIR


def _write_configs(tmp_path: Path, fail_on_call: int | None = None, device: str = "cpu") -> Path:
    model = tmp_path / "mock.yaml"
    lines = [
        "name: mock_half",
        "adapter: mock",
        "mock_mode: half",
        "license_code: x",
        "license_weights: y",
    ]
    if fail_on_call is not None:
        lines.append(f"fail_on_call: {fail_on_call}")
    model.write_text("\n".join(lines) + "\n", encoding="utf-8")
    cfg = tmp_path / "separation.yaml"
    cfg.write_text(
        f"model_config: {model.as_posix()}\ndevice: {device}\noutput:\n  format: flac\n"
        "max_duration_sec: 10\n",
        encoding="utf-8",
    )
    return cfg


def _song(tmp_path: Path) -> Path:
    path = tmp_path / "song.wav"
    write_wav(path, make_tone(1.0, SR, 220.0))
    return path


@pytest.fixture(autouse=True)
def _no_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ENV_DEVICE, raising=False)
    monkeypatch.delenv(ENV_WORK_DIR, raising=False)


def test_정상이면_0과_세_파일(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    cfg = _write_configs(tmp_path)
    out = tmp_path / "out"
    assert main(["separate", str(_song(tmp_path)), "--out", str(out), "--config", str(cfg)]) == 0
    assert (out / "drums.flac").is_file() and (out / "accompaniment.flac").is_file()
    meta = json.loads((out / "separation.json").read_text(encoding="utf-8"))
    assert meta["duration_ms"] == 1000 and meta["model_name"] == "mock_half"
    assert meta["audio_time_origin"] == "SOURCE_START"
    assert meta["drum_stem_path"] == str(out / "drums.flac")
    assert meta["peak_vram_mb"] is None
    captured = capsys.readouterr()
    assert "드럼 트랙:" in captured.out and "결과 메타:" in captured.out
    assert "[SEPARATE] 끝" in captured.err and "장치: cpu" in captured.err


def test_입력_오류는_2(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    cfg = _write_configs(tmp_path)
    out = tmp_path / "out"
    code = main(["separate", str(tmp_path / "없음.wav"), "--out", str(out), "--config", str(cfg)])
    assert code == 2
    assert "[INPUT_INVALID]" in capsys.readouterr().err
    assert not (out / "separation.json").exists()


def test_모델_오류는_3(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    cfg = _write_configs(tmp_path, fail_on_call=1)
    out = tmp_path / "out"
    assert main(["separate", str(_song(tmp_path)), "--out", str(out), "--config", str(cfg)]) == 3
    assert "[MODEL_FAILED]" in capsys.readouterr().err


def test_out이_없으면_work_dir_아래_원곡_이름(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(ENV_WORK_DIR, str(tmp_path / "work"))
    cfg = _write_configs(tmp_path)
    assert main(["separate", str(_song(tmp_path)), "--config", str(cfg)]) == 0
    assert (tmp_path / "work" / "song" / "separation.json").is_file()


def test_out도_환경_변수도_없으면_1(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    cfg = _write_configs(tmp_path)
    assert main(["separate", str(_song(tmp_path)), "--config", str(cfg)]) == 1
    assert ENV_WORK_DIR in capsys.readouterr().err


def test_설정_파일이_없으면_1(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    code = main(
        ["separate", str(_song(tmp_path)), "--out", str(tmp_path / "o"), "--config", "없음.yaml"]
    )
    assert code == 1
    assert "설정을 읽지 못함" in capsys.readouterr().err


def test_device_인자가_설정을_덮어쓴다(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    cfg = _write_configs(tmp_path, device="cuda")
    out = tmp_path / "out"
    args = [
        "separate",
        str(_song(tmp_path)),
        "--out",
        str(out),
        "--config",
        str(cfg),
        "--device",
        "cpu",
    ]
    assert main(args) == 0
    assert "장치: cpu" in capsys.readouterr().err
