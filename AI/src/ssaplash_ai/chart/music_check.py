"""분리 전 음악 여부 검사. 원곡 파일 → 음악 확률·말소리 확률 → 기준에 걸리면 ChartNotTranscribableError.

원곡의 positions 위치에서 window_sec 구간을 뽑아 AST 분류 모델로 "Music"·"Speech" 확률을 구하고 구간 평균으로 판정.
구간 하나로 판정하지 않는 이유: 랩 곡은 구간 하나의 말소리 확률이 0.5를 넘기도 함.
흐름: MusicCheckModule(config).load() 한 번 → check_file() 곡마다 → close().
기준값 두 개가 모두 비어 있으면 모델을 올리지 않고 check_file()은 None을 돌려줌.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import soxr

from ssaplash_ai.bench.datasets.base import SAMPLE_RATE
from ssaplash_ai.chart.audio_io import read_audio_file
from ssaplash_ai.chart.config import MusicCheckConfig
from ssaplash_ai.chart.errors import (
    ChartError,
    ChartModelError,
    ChartNotTranscribableError,
    model_error_from,
    summarize_exception,
)

# AST 입력 샘플레이트
TAGGER_SAMPLE_RATE = 16000
MUSIC_LABEL = "Music"
SPEECH_LABEL = "Speech"


class AudioTagger(Protocol):
    """구간마다 음악 확률·말소리 확률을 내는 분류 모델."""

    name: str
    version: str

    def load(self) -> None: ...

    def predict(self, windows: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
        """모노 16kHz 구간 목록 → (구간별 음악 확률, 구간별 말소리 확률)."""
        ...

    def close(self) -> None: ...


class AstTagger:
    """Hugging Face transformers의 AST(AudioSet 527개 분류). 가중치는 Hugging Face 캐시 또는 로컬 폴더."""

    def __init__(self, model: str, device: str = "cpu") -> None:
        self.name = model
        self.version = "unknown"
        self.device = device
        self._extractor = None
        self._model = None
        self._torch = None
        self._music_id = -1
        self._speech_id = -1

    def load(self) -> None:
        import torch
        from transformers import ASTFeatureExtractor, ASTForAudioClassification

        extractor = ASTFeatureExtractor.from_pretrained(self.name)
        model = ASTForAudioClassification.from_pretrained(self.name).eval().to(self.device)
        label_ids = {str(label): int(i) for i, label in model.config.id2label.items()}
        for label in (MUSIC_LABEL, SPEECH_LABEL):
            if label not in label_ids:
                raise ValueError(f"분류 모델에 {label!r} 분류가 없음: {self.name}")
        self._music_id, self._speech_id = label_ids[MUSIC_LABEL], label_ids[SPEECH_LABEL]
        self.version = _snapshot_version(self.name)
        self._extractor, self._model, self._torch = extractor, model, torch

    def predict(self, windows: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
        torch = self._torch
        inputs = self._extractor(windows, sampling_rate=TAGGER_SAMPLE_RATE, return_tensors="pt")
        with torch.no_grad():
            logits = self._model(**{k: v.to(self.device) for k, v in inputs.items()}).logits
        probs = torch.sigmoid(logits).cpu().numpy()
        return probs[:, self._music_id], probs[:, self._speech_id]

    def close(self) -> None:
        self._extractor = self._model = self._torch = None


def _snapshot_version(model: str) -> str:
    """Hugging Face 캐시에 받은 가중치의 커밋 해시 앞 12자리. 로컬 폴더거나 알 수 없으면 "local"."""
    try:
        from huggingface_hub import try_to_load_from_cache

        cached = try_to_load_from_cache(model, "config.json")
        if isinstance(cached, str):
            return Path(cached).parent.name[:12]
    except Exception:  # 버전 표시는 검사 동작과 무관하므로 실패해도 넘어감
        pass
    return "local"


def create_tagger(config: MusicCheckConfig) -> AudioTagger:
    """설정의 모델 이름으로 분류 모델 객체를 만듦. 올리기는 load()에서."""
    return AstTagger(config.model, config.device)


@dataclass
class MusicCheckOutput:
    """measure_file·check_file 결과."""

    music_prob: float
    speech_prob: float
    # 구간별 {"music": 음악 확률, "speech": 말소리 확률}
    window_probs: list[dict[str, float]]
    check_ms: int
    model_name: str
    model_version: str

    def to_dict(self) -> dict:
        return asdict(self)


def pick_windows(
    audio: np.ndarray, sample_rate: int, positions: tuple[float, ...], window_sec: float
) -> list[np.ndarray]:
    """(채널, 샘플) 배열에서 positions 위치마다 window_sec 길이 구간을 뽑아 모노 16kHz로 바꿈.

    구간이 곡 끝을 넘으면 끝에 맞춰 당김. 곡이 구간보다 짧으면 곡 전체가 구간 하나.
    """
    n = audio.shape[1]
    length = min(int(round(window_sec * sample_rate)), n)
    windows = []
    for pos in positions:
        start = max(0, min(int(pos * n), n - length))
        mono = audio[:, start : start + length].mean(axis=0)
        if sample_rate != TAGGER_SAMPLE_RATE:
            mono = soxr.resample(mono, sample_rate, TAGGER_SAMPLE_RATE)
        windows.append(np.ascontiguousarray(mono, dtype=np.float32))
    return windows


def failure_message(output: MusicCheckOutput, config: MusicCheckConfig) -> str | None:
    """기준에 걸린 조건의 값과 기준. 걸린 조건이 없으면 None. 실패 보고 summary로 나감."""
    parts = []
    if config.min_music_prob is not None and output.music_prob < config.min_music_prob:
        parts.append(f"음악 확률 {output.music_prob:.2f}, 기준 {config.min_music_prob:.2f}")
    if config.max_speech_prob is not None and output.speech_prob >= config.max_speech_prob:
        parts.append(f"말소리 확률 {output.speech_prob:.2f}, 기준 {config.max_speech_prob:.2f}")
    return " / ".join(parts) if parts else None


class MusicCheckModule:
    """분류 모델을 한 번 올려 여러 곡을 검사하는 모듈."""

    def __init__(self, config: MusicCheckConfig, tagger: AudioTagger | None = None) -> None:
        self.config = config
        self.load_sec: float | None = None
        self._tagger_arg = tagger
        self._tagger: AudioTagger | None = None

    @property
    def enabled(self) -> bool:
        return self.config.enabled

    @property
    def loaded(self) -> bool:
        return self._tagger is not None

    def load(self, force: bool = False) -> float:
        """분류 모델 올리기. 걸린 초를 돌려줌. 기준값이 비어 있으면 force가 아닌 한 올리지 않고 0."""
        if not (self.enabled or force):
            return 0.0
        started = time.perf_counter()
        tagger = self._tagger_arg if self._tagger_arg is not None else create_tagger(self.config)
        try:
            tagger.load()
        except ImportError as e:
            raise ChartModelError(
                f"음악 여부 검사에 필요한 패키지가 없음: {summarize_exception(e)}"
            ) from e
        except Exception as e:
            raise model_error_from(e, "음악 여부 검사 모델 올리기") from e
        self._tagger = tagger
        self.load_sec = time.perf_counter() - started
        return self.load_sec

    def measure_file(self, input_path: str | Path) -> MusicCheckOutput:
        """원곡 파일 → 음악 확률·말소리 확률. 기준과 비교하지 않음. 입력 검사에 걸리면 ChartInputError."""
        if self._tagger is None:
            raise ChartModelError("load()를 먼저 호출")
        started = time.perf_counter()
        audio = read_audio_file(input_path, SAMPLE_RATE, self.config.max_duration_sec)
        windows = pick_windows(audio, SAMPLE_RATE, self.config.positions, self.config.window_sec)
        try:
            music, speech = self._tagger.predict(windows)
        except ChartError:
            raise
        except Exception as e:
            raise model_error_from(e, "음악 여부 검사") from e
        music = np.asarray(music, dtype=np.float64)
        speech = np.asarray(speech, dtype=np.float64)
        return MusicCheckOutput(
            music_prob=round(float(music.mean()), 4),
            speech_prob=round(float(speech.mean()), 4),
            window_probs=[
                {"music": round(float(m), 4), "speech": round(float(s), 4)}
                for m, s in zip(music, speech, strict=True)
            ],
            check_ms=int(round((time.perf_counter() - started) * 1000)),
            model_name=self._tagger.name,
            model_version=self._tagger.version,
        )

    def check_file(self, input_path: str | Path) -> MusicCheckOutput | None:
        """원곡 파일을 검사. 기준에 걸리면 ChartNotTranscribableError. 기준값이 비어 있으면 None."""
        if not self.enabled:
            return None
        output = self.measure_file(input_path)
        message = failure_message(output, self.config)
        if message is not None:
            raise ChartNotTranscribableError(f"음악이 아닌 파일로 판단: {message}")
        return output

    def close(self) -> None:
        """모델 해제. load 전에 불러도 됨."""
        if self._tagger is not None:
            self._tagger.close()
            self._tagger = None
