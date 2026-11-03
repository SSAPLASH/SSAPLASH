"""원곡 읽기·트랙 쓰기 테스트. 테스트가 직접 만드는 짧은 소리 파일만 사용."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from helpers import SR, make_tone, write_m4a, write_wav
from ssaplash_ai.chart.audio_io import (
    DECODER_PYAV,
    DECODER_SOUNDFILE,
    duration_ms,
    fit_length,
    probe,
    read_audio_file,
    samples_for_ms,
    write_audio_file,
)
from ssaplash_ai.chart.errors import ChartInputError, ChartOutputError


def _stereo(seconds: float = 1.0) -> np.ndarray:
    """좌우가 다른 스테레오 소리 (2, 샘플)."""
    left = make_tone(seconds, SR, 220.0)[0]
    right = make_tone(seconds, SR, 330.0)[0]
    return np.stack([left, right])


def test_wav를_읽으면_스테레오_44100_float32(tmp_path: Path):
    audio = _stereo(1.0)
    write_wav(tmp_path / "a.wav", audio)
    got = read_audio_file(tmp_path / "a.wav")
    assert got.shape == audio.shape and got.dtype == np.float32
    np.testing.assert_allclose(got, audio, atol=1e-4)  # 16비트 반올림


def test_모노_22050은_양쪽_채널로_복사하고_44100으로_바꾼다(tmp_path: Path):
    mono = make_tone(1.0, 22050, 220.0, channels=1)
    write_wav(tmp_path / "m.wav", mono, 22050)
    got = read_audio_file(tmp_path / "m.wav")
    assert got.shape[0] == 2
    assert abs(got.shape[1] - SR) <= 1
    np.testing.assert_array_equal(got[0], got[1])


def test_flac도_읽는다(tmp_path: Path):
    audio = _stereo(0.5)
    sf.write(str(tmp_path / "a.flac"), audio.T, SR, subtype="PCM_16")
    got = read_audio_file(tmp_path / "a.flac")
    assert got.shape == audio.shape


def test_mp3도_읽고_길이가_1ms_안이다(tmp_path: Path):
    audio = _stereo(1.0)
    path = tmp_path / "a.mp3"
    try:
        sf.write(str(path), audio.T, SR, format="MP3", subtype="MPEG_LAYER_III")
    except Exception:  # libsndfile에 mp3 인코더가 없는 환경
        pytest.skip("mp3 쓰기를 지원하지 않는 libsndfile")
    got = read_audio_file(path)
    assert got.shape[0] == 2
    assert abs(got.shape[1] - audio.shape[1]) <= SR // 1000


@pytest.mark.parametrize("codec", ["aac", "alac"])
def test_m4a를_읽으면_wav와_길이가_같고_시작이_안_밀린다(tmp_path: Path, codec: str):
    audio = _stereo(1.0)
    write_m4a(tmp_path / "a.m4a", audio, codec=codec)
    got = read_audio_file(tmp_path / "a.m4a")
    assert got.shape == audio.shape and got.dtype == np.float32
    if codec == "alac":  # 16비트 무손실
        np.testing.assert_allclose(got, audio, atol=1e-4)
    else:  # 손실 압축이라 샘플 값 대신 신호 대 잡음비로 봄. 테스트 소리는 약 22dB
        snr = 10 * np.log10(np.sum(audio**2) / np.sum((got - audio) ** 2))
        assert snr > 15


@pytest.mark.parametrize("codec", ["aac", "alac"])
def test_m4a는_시작이_밀리지_않는다(tmp_path: Path, codec: str):
    # 0.2초 간격 딸깍 소리. 상호상관 최대 위치로 원본과 어긋난 샘플 수를 잼
    audio = np.zeros((2, SR), dtype=np.float32)
    for start in (0.1, 0.3, 0.6):
        i = int(start * SR)
        audio[:, i : i + 200] = 0.8 * np.hanning(200)
    write_m4a(tmp_path / "a.m4a", audio, codec=codec)
    got = read_audio_file(tmp_path / "a.m4a")
    lag = int(np.argmax(np.correlate(got[0], audio[0], "full"))) - (audio.shape[1] - 1)
    # AAC 앞쪽 인코더 지연은 1024샘플. 이게 안 빠지면 lag가 1024 근처로 나옴
    assert abs(lag) <= 2


def test_확장자가_없는_m4a도_읽는다(tmp_path: Path):
    write_m4a(tmp_path / "source.audio", _stereo(0.5))
    got = read_audio_file(tmp_path / "source.audio")
    assert got.shape == (2, SR // 2)


def test_m4a_probe는_pyav로_헤더를_읽는다(tmp_path: Path):
    write_m4a(tmp_path / "a.m4a", _stereo(1.0))
    info = probe(tmp_path / "a.m4a")
    assert info.decoder == DECODER_PYAV and info.format.endswith("/aac")
    assert info.sample_rate == SR and info.channels == 2 and info.frames == SR


def test_m4a도_길이_상한을_디코딩_전에_본다(tmp_path: Path):
    write_m4a(tmp_path / "a.m4a", _stereo(1.0))
    with pytest.raises(ChartInputError, match="너무 긺"):
        read_audio_file(tmp_path / "a.m4a", max_duration_sec=0.5)


def test_손상된_m4a는_입력_오류(tmp_path: Path):
    write_m4a(tmp_path / "a.m4a", _stereo(1.0))
    data = (tmp_path / "a.m4a").read_bytes()
    (tmp_path / "bad.m4a").write_bytes(data[: len(data) // 3])  # 뒤쪽 2/3 잘림
    (tmp_path / "junk.m4a").write_bytes(b"not audio at all " * 100)
    with pytest.raises(ChartInputError):
        read_audio_file(tmp_path / "bad.m4a")
    with pytest.raises(ChartInputError, match="읽지 못함"):
        read_audio_file(tmp_path / "junk.m4a")


def test_ogg_opus는_soundfile로_읽고_길이가_1ms_안이다(tmp_path: Path):
    audio = make_tone(1.0, 48000, 220.0)
    path = tmp_path / "a.opus"
    sf.write(str(path), audio.T, 48000, format="OGG", subtype="OPUS")
    assert probe(path).decoder == DECODER_SOUNDFILE
    got = read_audio_file(path)
    assert got.shape[0] == 2
    assert abs(got.shape[1] - SR) <= SR // 1000


def test_없는_파일은_입력_오류(tmp_path: Path):
    with pytest.raises(ChartInputError, match="없음") as info:
        read_audio_file(tmp_path / "x.wav")
    assert info.value.code == "INPUT_INVALID" and info.value.retryable is False


def test_손상_파일은_입력_오류(tmp_path: Path):
    (tmp_path / "bad.wav").write_bytes(b"not audio at all " * 100)
    with pytest.raises(ChartInputError, match="읽지 못함"):
        read_audio_file(tmp_path / "bad.wav")


def test_길이_상한을_넘으면_입력_오류(tmp_path: Path):
    write_wav(tmp_path / "a.wav", _stereo(1.0))
    with pytest.raises(ChartInputError, match="너무 긺"):
        read_audio_file(tmp_path / "a.wav", max_duration_sec=0.5)
    assert read_audio_file(tmp_path / "a.wav", max_duration_sec=1.0).shape[1] == SR


def test_무음은_입력_오류(tmp_path: Path):
    write_wav(tmp_path / "s.wav", np.zeros((2, SR), dtype=np.float32))
    with pytest.raises(ChartInputError, match="무음"):
        read_audio_file(tmp_path / "s.wav")


def test_샘플레이트_이상은_입력_오류(tmp_path: Path):
    write_wav(tmp_path / "low.wav", make_tone(1.0, 4000, 220.0), 4000)
    with pytest.raises(ChartInputError, match="샘플레이트"):
        read_audio_file(tmp_path / "low.wav")


def test_probe는_헤더_정보를_돌려준다(tmp_path: Path):
    write_wav(tmp_path / "a.wav", _stereo(1.0))
    info = probe(tmp_path / "a.wav")
    assert info.sample_rate == SR and info.frames == SR and info.channels == 2
    assert info.duration_sec == pytest.approx(1.0)


@pytest.mark.parametrize("fmt", ["flac", "wav"])
def test_쓰고_읽으면_샘플_수가_같고_오차_1e_4_안(tmp_path: Path, fmt: str):
    audio = _stereo(0.5)
    path = write_audio_file(tmp_path / "sub" / f"d.{fmt}", audio, SR, fmt)
    assert path.suffix == f".{fmt}" and path.is_file()
    info = sf.info(str(path))
    assert info.frames == audio.shape[1] and info.subtype == "PCM_16"
    got, sr = sf.read(str(path), dtype="float32", always_2d=True)
    assert sr == SR
    assert float(np.max(np.abs(got.T - audio))) < 1e-4


def test_1을_넘는_값은_잘라_쓴다(tmp_path: Path):
    path = write_audio_file(tmp_path / "c.flac", np.full((2, 100), 1.5, dtype=np.float32), SR)
    got, _ = sf.read(str(path), dtype="float32", always_2d=True)
    assert float(np.max(got)) <= 1.0


def test_모르는_형식은_출력_오류(tmp_path: Path):
    with pytest.raises(ChartOutputError, match="출력 형식") as info:
        write_audio_file(tmp_path / "x.mp3", _stereo(0.1), SR, "mp3")
    assert info.value.code == "OUTPUT_INVALID"


def test_duration_ms는_반올림한_정수():
    assert duration_ms(44100, 44100) == 1000
    assert duration_ms(66150, 44100) == 1500
    assert duration_ms(44100 * 3 + 22, 44100) == 3000


def test_samples_for_ms는_정수_내림():
    assert samples_for_ms(1000, 44100) == 44100
    assert samples_for_ms(1, 44100) == 44  # 44.1 → 44
    assert samples_for_ms(4030, 44100) == 177723
    with pytest.raises(ValueError, match="양수"):
        samples_for_ms(0, 44100)


def test_fit_length는_끝에서만_자르거나_채운다():
    audio = _stereo(0.01)  # 441 샘플
    same = fit_length(audio, 441)
    assert same is audio
    shorter = fit_length(audio, 400)
    assert shorter.shape == (2, 400)
    np.testing.assert_array_equal(shorter, audio[:, :400])
    longer = fit_length(audio, 500)
    assert longer.shape == (2, 500) and longer.dtype == audio.dtype
    np.testing.assert_array_equal(longer[:, :441], audio)
    assert float(np.max(np.abs(longer[:, 441:]))) == 0.0
    with pytest.raises(ValueError, match="양수"):
        fit_length(audio, 0)
