"""bpm 추정 (설계 3장 채보 JSON `timing`, U4·U14·U15).

방법은 설정 `tempo.method`로 고름.
- beat_this(서비스): Beat This!(CPJKU, ISMIR 2024, 코드·가중치 MIT)로 박과 마디 첫 박 시각을 구함.
  GMD test 45곡에서 정답 bpm ±2% 안에 45곡이 들어 librosa(25곡)·madmom(32곡)보다 나았음(설계 U15)
- librosa: `beat.beat_track`. torch 없이 돌아서 mock 설정과 테스트용으로 남김

박 시각에서 bpm을 계산하는 방법은 둘이 같음. 박 간격 중앙값에서 15% 넘게 벗어난 간격(박을 건너뛰거나
두 번 잡은 곳)에서 박을 구간으로 나누고, 구간마다 몇 번째 박인지와 울린 시각을 짝지어 박들이 몇 초에 걸쳐
나왔는지로 한 박 길이를 구함. 구간들은 합쳐 한 박 길이 하나로 냄.
[min_bpm, max_bpm] 밖이면 2배·절반으로 접어 넣음. 설정 tempo.tempo_map이 켜져 있으면 찾은 박을 따라가는
빠르기 구간(tempoMap)도 만듦(tempo_map_from_beats, 설계 CHART-003-variable-tempo-exp).

박을 못 찾으면(타격이 거의 없는 드럼 트랙) BE가 받는 기본값 120을 쓰고 estimated를 거짓으로 둠.
채보 JSON의 offsetMs는 마디 첫 박 다수결 위치(없으면 첫 마디 첫 박, 첫 박)로 chart_json이 정하고,
설정에 따라 킥·스네어 노트 보정과 빠르기 구간을 반영함(U14·U16).

Beat This! 가중치는 SSAPLASH_MODELS_DIR(기본 data/models)/beat_this/에 두고 md5로 확인함. 없으면 공식 서버,
안 되면 개발자 사이트에서 받음(2026-10 공식 서버 고장, GitHub 이슈 #20·#23).
"""

from __future__ import annotations

import abc
import hashlib
import math
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soxr

from ssaplash_ai.chart.config import ENV_MODELS_DIR, TempoConfig

LIBROSA_SAMPLE_RATE = 22050
FALLBACK_BPM = 120.0
# 박 간격 중앙값에서 이 비율 넘게 벗어난 간격은 bpm 계산에서 뺌
INTERVAL_TOLERANCE = 0.15
MIN_INTERVALS = 3
# 마디 첫 박 다수결(downbeat_phase_ms): 한 마디 안 후보 위치 간격과, 후보에서 이 거리 안의 마디 첫 박을 셈
DOWNBEAT_VOTE_STEP_MS = 10
DOWNBEAT_VOTE_WINDOW_MS = 35

BEAT_THIS_CHECKPOINT = "final0"
# 개발자가 GitHub 이슈 #20에 올린 md5
BEAT_THIS_MD5 = {"final0": "9fdf5e3f69b9996870e7aecd69527b08"}
BEAT_THIS_URLS = (
    "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/{name}.ckpt",
    "https://f0k.de/pubs/2024_ismir/beat_this-{name}.ckpt",
)
DOWNLOAD_TIMEOUT_SEC = 60
DEFAULT_MODELS_DIR = Path("data/models")


@dataclass
class TempoEstimate:
    """bpm 추정 결과. bpm은 박 간격으로 계산하고 접은 값(소수 둘째 자리), raw_bpm은 접기 전 값.

    downbeat_phase_ms는 마디 첫 박 전부를 한 마디 길이로 접은 다수결 위치(downbeat_phase_ms 함수).
    마디 첫 박이 없거나 bpm 추정 실패면 None.
    tempo_map은 찾은 박을 따라가는 빠르기 구간 시작 목록(tempo_map_from_beats). 설정이 꺼졌거나 못 만들면 None.
    """

    bpm: float
    raw_bpm: float | None
    first_beat_ms: int | None
    first_downbeat_ms: int | None
    n_beats: int
    time_signature: str
    estimated: bool
    method: str
    downbeat_phase_ms: int | None = None
    tempo_map: list[TempoMapPoint] | None = None


@dataclass(frozen=True)
class TempoMapPoint:
    """빠르기 구간 시작. time_ms는 곡 시각(박 시각 기준, 노트 보정 전), beat은 첫 마디 첫 박을 0으로 센 박 번호,
    bpm은 다음 구간 시작까지의 빠르기(소수 둘째 자리). 마지막 구간은 곡 끝까지 같은 빠르기."""

    time_ms: float
    beat: int
    bpm: float


def fold_bpm(bpm: float, min_bpm: float, max_bpm: float) -> float:
    """[min_bpm, max_bpm] 안에 들 때까지 2배 또는 절반. max_bpm >= 2 * min_bpm이면 항상 끝남."""
    while bpm < min_bpm:
        bpm *= 2.0
    while bpm > max_bpm:
        bpm /= 2.0
    return bpm


def _beat_period_from_runs(beats: np.ndarray, even: np.ndarray) -> float | None:
    """한 박 길이(초). 고른 간격이 MIN_INTERVALS개 이상 이어지는 구간마다 박 번호와 시각을 짝지어 구함.

    구간마다 시작 시각은 따로 두고 한 박 길이는 모든 구간에 같은 값 하나로 최소제곱 계산. 쓸 구간이 없으면 None.
    """
    num = den = 0.0
    start = 0
    while start < even.size:
        if not even[start]:
            start += 1
            continue
        end = start
        while end < even.size and even[end]:
            end += 1
        if end - start >= MIN_INTERVALS:
            run = beats[start : end + 1]
            index = np.arange(run.size) - (run.size - 1) / 2
            num += float(np.sum(index * (run - run.mean())))
            den += float(np.sum(index * index))
        start = end
    return num / den if den > 0 else None


def bpm_from_beats(beats: np.ndarray) -> float | None:
    """박 시각(초) → bpm. 고른 간격(중앙값 ±15%)이 MIN_INTERVALS 미만이면 None.

    고른 간격이 이어지는 구간마다 박 번호와 시각을 짝지어 한 박 길이를 구함. 박 시각이 20ms 단위라 간격 평균은
    0.03~0.06bpm 오차가 남아 3분 곡 끝에서 16분 격자를 벗어남(설계 "격자 원점·bpm 계산 수정").
    그런 구간이 없으면 고른 간격 평균.
    """
    if beats.size < 2:
        return None
    intervals = np.diff(beats)
    median = float(np.median(intervals))
    if median <= 0:
        return None
    even = np.abs(intervals - median) <= INTERVAL_TOLERANCE * median
    if int(np.sum(even)) < MIN_INTERVALS:
        return None
    period = _beat_period_from_runs(beats, even)
    if period is None:
        period = float(np.mean(intervals[even]))
    return 60.0 / period


def _ms(seconds: np.ndarray) -> int | None:
    return int(round(float(seconds[0]) * 1000)) if seconds.size else None


def downbeat_phase_ms(downbeats: np.ndarray, bar_ms: float) -> int | None:
    """마디 첫 박 시각(초) 전부를 한 마디 길이로 접어 가장 많이 모인 위치(ms, 0 이상 bar_ms 미만).

    0부터 DOWNBEAT_VOTE_STEP_MS 간격 후보마다 ±DOWNBEAT_VOTE_WINDOW_MS 안의 마디 첫 박 수를 셈. 마디 길이를
    넘는 차이는 한 바퀴 돌려 셈(마디 끝 근처와 처음 근처가 같은 위치). 가장 많이 센 후보(동점이면 가장 이른
    후보)의 창 안 마디 첫 박들과 후보의 차이 중앙값만큼 옮긴 위치를 냄. 후보 간격·창 폭 때문에 생기는 치우침을 없앰.
    첫 번째 마디 첫 박 하나만 쓰면 드럼 인트로·필인에서 틀린 박을 원점으로 잡는 곡이 많아서 곡 전체로 정함
    (설계 CHART-003-downbeat-vote, Songsterr 131곡 중 마디선이 맞는 곡 52 → 75).
    마디 첫 박이 없거나 bar_ms가 0 이하면 None.
    """
    if downbeats.size == 0 or not bar_ms > 0:
        return None
    phase = np.mod(downbeats * 1000.0, bar_ms)
    candidates = np.arange(0.0, bar_ms, DOWNBEAT_VOTE_STEP_MS)
    # 후보 → 마디 첫 박 부호 있는 차이(−bar_ms/2 ~ bar_ms/2)
    signed = (phase[None, :] - candidates[:, None] + bar_ms / 2) % bar_ms - bar_ms / 2
    inside = np.abs(signed) <= DOWNBEAT_VOTE_WINDOW_MS
    best = int(np.argmax(inside.sum(axis=1)))
    shift = float(np.median(signed[best][inside[best]]))
    return int(round(float((candidates[best] + shift) % bar_ms)))


def _merge_bar_knots(bar_ms: np.ndarray, tolerance_ms: float) -> list[int]:
    """마디 경계 시각 목록에서 빠르기 구간 시작으로 쓸 경계 번호. 구간 안 모든 마디 경계가 처음·끝을 잇는 일정
    간격에서 tolerance_ms 안이면 구간을 늘림. 마지막 경계 번호도 넣음."""
    knots = [0]
    i, n = 0, len(bar_ms)
    while i < n - 1:
        j = i + 1
        while j + 1 < n:
            span = bar_ms[i : j + 2]
            line = span[0] + (span[-1] - span[0]) * np.arange(span.size) / (span.size - 1)
            if np.max(np.abs(line - span)) > tolerance_ms:
                break
            j += 1
        knots.append(j)
        i = j
    return knots


def tempo_map_from_beats(
    beats: np.ndarray,
    downbeats: np.ndarray,
    beats_per_bar: int,
    tolerance_ms: float,
    min_bpm: float,
    max_bpm: float,
) -> list[TempoMapPoint] | None:
    """찾은 박을 따라가는 빠르기 구간 (설계 CHART-003-variable-tempo-exp 4장).

    1. 박을 beats_per_bar개씩 묶어 마디를 만듦. 어느 박을 마디 첫 박으로 할지는 박 번호를 beats_per_bar로 나눈
       나머지마다 마디 첫 박(±DOWNBEAT_VOTE_WINDOW_MS)과 겹치는 수를 세어 가장 많은 쪽(다수결)
    2. 마디 경계를 _merge_bar_knots로 묶어 구간을 만들고, 구간 bpm = 구간 박 수 × 60000 / 구간 길이
    3. bpm을 소수 둘째 자리로 반올림하면서 생기는 어긋남이 쌓이지 않게, 다음 구간 bpm은 반올림한 bpm으로
       다시 계산한 구간 시작에서 실제 다음 경계까지로 구함
    박이 beats_per_bar × 2 + 1개 미만이거나 마디 첫 박이 없거나, 구간 bpm 중앙값이 [min_bpm, max_bpm] 밖이면
    (박을 8분·2분 단위로 잡은 경우) None. 그때는 고정 bpm으로 냄.
    """
    if beats.size < beats_per_bar * 2 + 1 or downbeats.size == 0:
        return None
    window = DOWNBEAT_VOTE_WINDOW_MS / 1000.0
    near = np.abs(beats[:, None] - downbeats[None, :]).min(axis=1) <= window
    first = int(np.argmax([near[k::beats_per_bar].sum() for k in range(beats_per_bar)]))
    bar_ms = beats[first::beats_per_bar] * 1000.0
    if bar_ms.size < 2:
        return None
    knots = _merge_bar_knots(bar_ms, tolerance_ms)
    spans = [(knots[i], knots[i + 1]) for i in range(len(knots) - 1)]
    raw = [(b - a) * beats_per_bar * 60_000.0 / (bar_ms[b] - bar_ms[a]) for a, b in spans]
    if not min_bpm <= float(np.median(raw)) <= max_bpm:
        return None
    points: list[TempoMapPoint] = []
    start = float(bar_ms[0])
    for a, b in spans:
        n_beats = (b - a) * beats_per_bar
        bpm = round(n_beats * 60_000.0 / (float(bar_ms[b]) - start), 2)
        points.append(TempoMapPoint(time_ms=start, beat=a * beats_per_bar, bpm=bpm))
        start += n_beats * 60_000.0 / bpm
    return points


def estimate_from_beats(
    beats: np.ndarray,
    downbeats: np.ndarray | None,
    config: TempoConfig,
    method: str,
    hint_bpm: float | None = None,
) -> TempoEstimate:
    """박 시각 → TempoEstimate. 박 간격으로 bpm을 못 구하면 hint_bpm(librosa 템포 값), 그것도 없으면 120."""
    beats = np.asarray(beats, dtype=np.float64)
    downbeats = np.asarray(downbeats if downbeats is not None else [], dtype=np.float64)
    raw = bpm_from_beats(beats)
    if raw is None and hint_bpm is not None and math.isfinite(hint_bpm) and hint_bpm > 0:
        raw = hint_bpm
    if raw is None:
        return TempoEstimate(
            bpm=FALLBACK_BPM,
            raw_bpm=None,
            first_beat_ms=_ms(beats),
            first_downbeat_ms=_ms(downbeats),
            n_beats=int(beats.size),
            time_signature=config.time_signature,
            estimated=False,
            method=method,
        )
    bpm = round(fold_bpm(raw, config.min_bpm, config.max_bpm), 2)
    beats_per_bar = int(config.time_signature.split("/")[0])
    bar_ms = 60_000.0 / bpm * beats_per_bar
    tempo_map = None
    if config.tempo_map:
        tempo_map = tempo_map_from_beats(
            beats,
            downbeats,
            beats_per_bar,
            config.tempo_map_tolerance_ms,
            config.min_bpm,
            config.max_bpm,
        )
    return TempoEstimate(
        bpm=bpm,
        raw_bpm=round(raw, 2),
        first_beat_ms=_ms(beats),
        first_downbeat_ms=_ms(downbeats),
        n_beats=int(beats.size),
        time_signature=config.time_signature,
        estimated=True,
        method=method,
        downbeat_phase_ms=downbeat_phase_ms(downbeats, bar_ms),
        tempo_map=tempo_map,
    )


def _mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 2:
        return np.mean(audio, axis=0, dtype=np.float32)
    return audio.astype(np.float32)


class TempoEstimator(abc.ABC):
    """bpm 추정기 공통 틀. load() 한 번 → estimate() 곡마다 → close()."""

    method: str = ""

    def __init__(self, config: TempoConfig, device: str = "cpu") -> None:
        self.config = config
        self.device = device

    def load(self) -> None:  # noqa: B027 - 기본은 올릴 모델이 없음
        """모델 준비. 실패하면 예외(TranscriptionModule이 모델 오류로 감쌈)."""

    @abc.abstractmethod
    def estimate(self, audio: np.ndarray, sample_rate: int) -> TempoEstimate:
        """(채널, 샘플) 소리(원곡 또는 드럼 트랙) → TempoEstimate."""

    @property
    def version_id(self) -> str:
        """generatorVersion 해시에 넣는 값. 방법이나 가중치가 바뀌면 바뀜."""
        return self.method

    def close(self) -> None:  # noqa: B027 - 기본은 해제할 것이 없음
        pass


class LibrosaTempo(TempoEstimator):
    """librosa beat_track. 모노 22050Hz로 바꿔 돌림. torch가 필요 없음."""

    method = "librosa"

    def estimate(self, audio: np.ndarray, sample_rate: int) -> TempoEstimate:
        import librosa

        mono = _mono(audio)
        if sample_rate != LIBROSA_SAMPLE_RATE:
            mono = soxr.resample(mono, sample_rate, LIBROSA_SAMPLE_RATE).astype(np.float32)
        tempo, beats = librosa.beat.beat_track(y=mono, sr=LIBROSA_SAMPLE_RATE, units="time")
        hint = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else None
        return estimate_from_beats(np.asarray(beats), None, self.config, self.method, hint)


def models_dir() -> Path:
    """가중치 폴더. SSAPLASH_MODELS_DIR이 있으면 그 값, 없으면 data/models."""
    value = os.environ.get(ENV_MODELS_DIR)
    return Path(value) if value else DEFAULT_MODELS_DIR


def file_md5(path: Path) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_beat_this_checkpoint(
    name: str = BEAT_THIS_CHECKPOINT,
    directory: Path | None = None,
    urls: tuple[str, ...] = BEAT_THIS_URLS,
) -> Path:
    """가중치 파일 경로. 없거나 md5가 다르면 urls 순서대로 받아 md5가 맞는 것만 남김. 다 실패하면 RuntimeError."""
    expected = BEAT_THIS_MD5[name]
    directory = directory or models_dir() / "beat_this"
    path = directory / f"beat_this-{name}.ckpt"
    if path.is_file() and file_md5(path) == expected:
        return path
    directory.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    failures: list[str] = []
    for template in urls:
        url = template.format(name=name)
        try:
            with (
                urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SEC) as resp,
                open(tmp, "wb") as f,
            ):
                while chunk := resp.read(1 << 20):
                    f.write(chunk)
        except Exception as e:
            failures.append(f"{url.split('/')[2]}: {type(e).__name__}")
            continue
        got = file_md5(tmp)
        if got != expected:
            failures.append(f"{url.split('/')[2]}: md5 불일치")
            continue
        tmp.replace(path)
        return path
    tmp.unlink(missing_ok=True)
    raise RuntimeError(f"Beat This! 가중치를 받지 못함 ({'; '.join(failures)})")


class BeatThisTempo(TempoEstimator):
    """Beat This! final0. 박과 마디 첫 박을 냄. 입력 샘플레이트 변환은 Beat This!가 함."""

    method = "beat_this"

    def __init__(self, config: TempoConfig, device: str = "cpu") -> None:
        super().__init__(config, device)
        self._model = None
        self.checkpoint_path: Path | None = None

    def load(self) -> None:
        from beat_this.inference import Audio2Beats

        self.checkpoint_path = ensure_beat_this_checkpoint()
        # dbn은 madmom이 있어야 함(transcribers extra, 설계 CHART-003-variable-tempo-exp U1)
        self._model = Audio2Beats(
            checkpoint_path=str(self.checkpoint_path),
            device=self.device,
            dbn=self.config.postprocess == "dbn",
        )

    def estimate(self, audio: np.ndarray, sample_rate: int) -> TempoEstimate:
        if self._model is None:
            raise RuntimeError("Beat This!: load()를 먼저 호출")
        beats, downbeats = self._model(_mono(audio), sample_rate)
        return estimate_from_beats(
            np.asarray(beats), np.asarray(downbeats), self.config, self.method
        )

    @property
    def version_id(self) -> str:
        return f"{self.method}:{BEAT_THIS_CHECKPOINT}:{BEAT_THIS_MD5[BEAT_THIS_CHECKPOINT]}"

    def close(self) -> None:
        self._model = None


ESTIMATORS: dict[str, type[TempoEstimator]] = {
    LibrosaTempo.method: LibrosaTempo,
    BeatThisTempo.method: BeatThisTempo,
}


def create_tempo_estimator(config: TempoConfig, device: str = "cpu") -> TempoEstimator:
    """config.method에 맞는 추정기. 모델은 load()에서 올림."""
    return ESTIMATORS[config.method](config, device)
