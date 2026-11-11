"""분리 전 음악 여부 검사 테스트. 분류 모델은 정해 둔 확률을 돌려주는 대역을 쓰고, 소리 파일은 테스트가 직접 만듦."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_hits, make_tone, write_wav
from ssaplash_ai.chart import music_check
from ssaplash_ai.chart.cli import main
from ssaplash_ai.chart.config import DEFAULT_MUSIC_CHECK_CONFIG, MusicCheckConfig
from ssaplash_ai.chart.errors import (
    ChartInputError,
    ChartModelError,
    ChartNotTranscribableError,
)
from ssaplash_ai.chart.music_check import (
    TAGGER_SAMPLE_RATE,
    MusicCheckModule,
    MusicCheckOutput,
    failure_message,
    pick_windows,
)


class FakeTagger:
    """구간마다 정해 둔 음악 확률·말소리 확률을 돌려주는 분류 모델 대역."""

    name = "fake_tagger"
    version = "v1"

    def __init__(self, music, speech, load_error: Exception | None = None, fail: bool = False):
        self.music, self.speech = music, speech
        self.load_error, self.fail = load_error, fail
        self.loaded = False
        self.window_lengths: list[int] = []

    def load(self) -> None:
        if self.load_error is not None:
            raise self.load_error
        self.loaded = True

    def predict(self, windows):
        if self.fail:
            raise RuntimeError("분류 모델 실행 실패")
        self.window_lengths = [len(w) for w in windows]
        n = len(windows)
        music = np.broadcast_to(np.asarray(self.music, dtype=np.float32), (n,))
        speech = np.broadcast_to(np.asarray(self.speech, dtype=np.float32), (n,))
        return music, speech

    def close(self) -> None:
        self.loaded = False


def _config(**kwargs) -> MusicCheckConfig:
    raw = {"min_music_prob": 0.28, "max_speech_prob": 0.44, **kwargs}
    return MusicCheckConfig.from_dict(raw)


def _song(tmp_path: Path, seconds: float = 2.2) -> Path:
    path = tmp_path / "song.wav"
    write_wav(path, make_hits(seconds))
    return path


def _module(tagger: FakeTagger, **kwargs) -> MusicCheckModule:
    module = MusicCheckModule(_config(**kwargs), tagger=tagger)
    module.load()
    return module


# ---- 설정 ----


def test_기준값이_없으면_꺼져_있다():
    config = MusicCheckConfig.from_dict({})
    assert config.enabled is False and config.device == "cpu"
    assert config.positions == (0.2, 0.4, 0.6, 0.8) and config.window_sec == 10.0


def test_기준값이_하나라도_있으면_켜진다():
    assert MusicCheckConfig.from_dict({"min_music_prob": 0.28}).enabled is True
    assert MusicCheckConfig.from_dict({"max_speech_prob": 0.44}).enabled is True


def test_저장소_기본_설정은_기준값_두_개가_들어_있다():
    config = MusicCheckConfig.from_yaml(DEFAULT_MUSIC_CHECK_CONFIG)
    assert config.enabled and config.min_music_prob == 0.28 and config.max_speech_prob == 0.44
    assert config.model.startswith("MIT/ast-finetuned-audioset")


@pytest.mark.parametrize(
    "raw, match",
    [
        ({"threshold": 0.3}, "모르는"),
        ({"min_music_prob": 1.5}, "min_music_prob"),
        ({"max_speech_prob": 0}, "max_speech_prob"),
        ({"positions": []}, "positions"),
        ({"positions": [0.2, 1.2]}, "positions"),
        ({"window_sec": 0}, "window_sec"),
        ({"model": " "}, "model"),
    ],
)
def test_잘못된_설정은_ValueError(raw: dict, match: str):
    with pytest.raises(ValueError, match=match):
        MusicCheckConfig.from_dict(raw)


# ---- 구간 뽑기 ----


def test_구간은_위치마다_하나씩이고_모노_16kHz다():
    audio = make_tone(30.0)
    windows = pick_windows(audio, SR, (0.2, 0.4, 0.6, 0.8), 10.0)
    assert len(windows) == 4
    assert all(w.ndim == 1 and w.dtype == np.float32 for w in windows)
    assert all(abs(len(w) - 10 * TAGGER_SAMPLE_RATE) <= 1 for w in windows)


def test_구간이_곡_끝을_넘으면_끝에_맞춰_당긴다():
    # 왼쪽 채널 값이 샘플 번호라 어느 위치를 뽑았는지 알 수 있음
    n = 30 * TAGGER_SAMPLE_RATE
    audio = np.stack([np.arange(n, dtype=np.float32)] * 2)
    windows = pick_windows(audio, TAGGER_SAMPLE_RATE, (0.0, 0.8, 1.0), 10.0)
    assert windows[0][0] == 0
    assert windows[1][0] == 20 * TAGGER_SAMPLE_RATE and windows[1][-1] == n - 1
    assert windows[2][0] == 20 * TAGGER_SAMPLE_RATE


def test_곡이_구간보다_짧으면_곡_전체가_구간이다():
    windows = pick_windows(make_tone(3.0), SR, (0.2, 0.8), 10.0)
    assert [abs(len(w) - 3 * TAGGER_SAMPLE_RATE) <= 1 for w in windows] == [True, True]


# ---- 판정 ----


def test_기준을_넘으면_확률과_모델_이름을_돌려준다(tmp_path: Path):
    tagger = FakeTagger(music=0.8, speech=0.02)
    out = _module(tagger).check_file(_song(tmp_path))
    assert isinstance(out, MusicCheckOutput)
    assert out.music_prob == pytest.approx(0.8) and out.speech_prob == pytest.approx(0.02)
    assert len(out.window_probs) == 4 and out.window_probs[0] == {"music": 0.8, "speech": 0.02}
    assert out.model_name == "fake_tagger" and out.model_version == "v1" and out.check_ms >= 0
    assert len(tagger.window_lengths) == 4


def test_음악_확률이_기준_미만이면_NOT_TRANSCRIBABLE(tmp_path: Path):
    with pytest.raises(ChartNotTranscribableError) as info:
        _module(FakeTagger(music=0.15, speech=0.1)).check_file(_song(tmp_path))
    e = info.value
    assert e.code == "INPUT_INVALID" and e.reason == "NOT_TRANSCRIBABLE" and e.retryable is False
    assert "음악 확률 0.15, 기준 0.28" in e.message and "말소리" not in e.message


def test_말소리_확률이_기준_이상이면_NOT_TRANSCRIBABLE(tmp_path: Path):
    with pytest.raises(ChartNotTranscribableError) as info:
        _module(FakeTagger(music=0.5, speech=0.44)).check_file(_song(tmp_path))
    assert "말소리 확률 0.44, 기준 0.44" in info.value.message
    assert "음악 확률" not in info.value.message


def test_둘_다_걸리면_메시지에_둘_다_적는다(tmp_path: Path):
    with pytest.raises(ChartNotTranscribableError) as info:
        _module(FakeTagger(music=0.15, speech=0.63)).check_file(_song(tmp_path))
    message = info.value.message
    assert "음악 확률 0.15, 기준 0.28" in message and "말소리 확률 0.63, 기준 0.44" in message
    assert len(message) <= 200 and "\n" not in message


def test_구간_하나가_아니라_평균으로_판정한다(tmp_path: Path):
    # 구간 하나는 말소리 확률 0.9지만 평균은 0.3이라 통과
    tagger = FakeTagger(music=[0.2, 0.9, 0.9, 0.9], speech=[0.9, 0.1, 0.1, 0.1])
    out = _module(tagger).check_file(_song(tmp_path))
    assert out.music_prob == pytest.approx(0.725) and out.speech_prob == pytest.approx(0.3)


def test_기준값이_하나만_있으면_그_조건만_본다(tmp_path: Path):
    tagger = FakeTagger(music=0.1, speech=0.9)
    only_music = MusicCheckModule(MusicCheckConfig.from_dict({"min_music_prob": 0.28}), tagger)
    only_music.load()
    with pytest.raises(ChartNotTranscribableError, match="음악 확률"):
        only_music.check_file(_song(tmp_path))
    tagger = FakeTagger(music=0.1, speech=0.1)
    only_speech = MusicCheckModule(MusicCheckConfig.from_dict({"max_speech_prob": 0.44}), tagger)
    only_speech.load()
    assert only_speech.check_file(_song(tmp_path)) is not None


def test_failure_message는_걸린_조건이_없으면_None():
    out = MusicCheckOutput(0.5, 0.1, [], 0, "m", "v")
    assert failure_message(out, _config()) is None
    assert failure_message(out, MusicCheckConfig.from_dict({})) is None


# ---- 꺼짐·오류 ----


def test_꺼져_있으면_모델을_올리지_않고_검사도_하지_않는다(tmp_path: Path):
    tagger = FakeTagger(music=0.0, speech=1.0)
    module = MusicCheckModule(MusicCheckConfig.from_dict({}), tagger=tagger)
    assert module.load() == 0.0 and not module.loaded and not tagger.loaded
    assert module.check_file(tmp_path / "없는_파일.wav") is None


def test_force로_올리면_꺼져_있어도_확률을_구한다(tmp_path: Path):
    module = MusicCheckModule(MusicCheckConfig.from_dict({}), tagger=FakeTagger(0.1, 0.9))
    module.load(force=True)
    out = module.measure_file(_song(tmp_path))
    assert out.music_prob == pytest.approx(0.1) and module.check_file(_song(tmp_path)) is None


def test_load_전에_검사하면_ChartModelError(tmp_path: Path):
    module = MusicCheckModule(_config(), tagger=FakeTagger(0.8, 0.0))
    with pytest.raises(ChartModelError, match="load"):
        module.check_file(_song(tmp_path))


def test_패키지가_없으면_ChartModelError():
    module = MusicCheckModule(_config(), tagger=FakeTagger(0, 0, load_error=ImportError("x")))
    with pytest.raises(ChartModelError, match="패키지"):
        module.load()
    assert not module.loaded


def test_모델을_못_올리면_ChartModelError():
    module = MusicCheckModule(_config(), tagger=FakeTagger(0, 0, load_error=OSError("no file")))
    with pytest.raises(ChartModelError, match="올리기"):
        module.load()


def test_분류_모델_실행이_실패하면_ChartModelError(tmp_path: Path):
    with pytest.raises(ChartModelError, match="음악 여부 검사 실패"):
        _module(FakeTagger(0.8, 0.0, fail=True)).check_file(_song(tmp_path))


def test_무음_원곡은_입력_오류_그대로(tmp_path: Path):
    silent = tmp_path / "silent.wav"
    write_wav(silent, np.zeros((2, SR), dtype=np.float32))
    with pytest.raises(ChartInputError, match="무음") as info:
        _module(FakeTagger(0.8, 0.0)).check_file(silent)
    assert info.value.reason == "SOURCE_INVALID"


def test_close_뒤에는_다시_올려야_한다(tmp_path: Path):
    module = _module(FakeTagger(0.8, 0.0))
    module.close()
    assert not module.loaded
    module.close()  # 두 번 불러도 됨


# ---- 명령줄 ----


def _write_config(
    tmp_path: Path, body: str = "min_music_prob: 0.28\nmax_speech_prob: 0.44\n"
) -> Path:
    path = tmp_path / "music_check.yaml"
    path.write_text(body, encoding="utf-8")
    return path


def test_명령줄은_통과하면_0이고_확률을_출력한다(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(music_check, "create_tagger", lambda config: FakeTagger(0.8, 0.02))
    code = main(["music-check", str(_song(tmp_path)), "--config", str(_write_config(tmp_path))])
    out = capsys.readouterr().out
    assert code == 0
    assert "음악 확률 0.8000" in out and "말소리 확률 0.0200" in out and "판정: 통과" in out


def test_명령줄은_기준에_걸리면_2(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(music_check, "create_tagger", lambda config: FakeTagger(0.15, 0.63))
    code = main(["music-check", str(_song(tmp_path)), "--config", str(_write_config(tmp_path))])
    out = capsys.readouterr().out
    assert code == 2 and "판정: 실패" in out and "음악 확률 0.15, 기준 0.28" in out


def test_명령줄은_기준값이_비어_있어도_확률을_보여_준다(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(music_check, "create_tagger", lambda config: FakeTagger(0.1, 0.9))
    cfg = _write_config(tmp_path, "device: cpu\n")
    code = main(["music-check", str(_song(tmp_path)), "--config", str(cfg)])
    out = capsys.readouterr().out
    assert code == 0 and "기준 없음" in out and "판정: 통과" in out


def test_명령줄은_설정_파일이_없으면_1(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    code = main(["music-check", str(_song(tmp_path)), "--config", str(tmp_path / "none.yaml")])
    assert code == 1 and "설정을 읽지 못함" in capsys.readouterr().err


def test_명령줄은_입력_파일이_없으면_2(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(music_check, "create_tagger", lambda config: FakeTagger(0.8, 0.0))
    code = main(
        ["music-check", str(tmp_path / "none.wav"), "--config", str(_write_config(tmp_path))]
    )
    assert code == 2 and "INPUT_INVALID" in capsys.readouterr().err
