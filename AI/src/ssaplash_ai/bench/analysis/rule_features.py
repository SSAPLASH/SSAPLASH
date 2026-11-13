"""규칙 분석용 특징 저장. ADTOF 타격 시각과 드럼 킷 분리 트랙을 곡마다 한 번만 GPU로 계산해 npz로 저장.

저장 내용 (곡 하나 = npz 하나, 경로 `data/rule_features/{데이터셋}/{곡}.npz`. 이미 있으면 건너뜀)
- peaks_{피치}: ADTOF가 잡은 시각(초). 35 킥·38 스네어·42 하이햇·47 탐·49 심벌, 체크포인트에 따라 44 페달·51 라이드
- activations: 프레임(100fps)별 확신 점수 (프레임, 클래스 수) float16. 옛 파일에는 없을 수 있음
- stem_{이름}: 드럼 킷 분리 트랙(kick·snare·toms·hh·ride·crash). 모노 float16. 옛 파일은 toms·crash·ride만
- sample_rate, duration_sec, meta(json: 모델·checkpoint·설정 해시·기본 규칙)
"""

from __future__ import annotations

import json
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
from ssaplash_ai.bench.runner.run_support import Logger, resolve_device
from ssaplash_ai.bench.transcribers import TranscriberConfig, create_transcriber
from ssaplash_ai.bench.transcribers.transcriber_base import to_mono

FEATURES_ROOT = Path("data/rule_features")
ADTOF_PITCHES: tuple[int, ...] = (35, 38, 42, 47, 49)
STEM_DTYPE = np.float16


@dataclass
class RuleFeatures:
    """곡 하나의 저장 특징. stems 값은 (1, 샘플) float32로 돌려줌 (규칙 함수가 (채널, 샘플)을 받음).

    input_audio는 어댑터에 넣은 드럼 입력(모노 (1, 샘플) float16). npz에는 없고 rule_eval이 데이터셋에서
    읽어 채움. 탐 아닌 소리 거르기(tom_gate_ratio)가 toms 트랙과 비교할 기준.
    """

    peaks: dict[int, np.ndarray]
    stems: dict[str, np.ndarray]
    sample_rate: int
    duration_sec: float
    meta: dict = field(default_factory=dict)
    input_audio: np.ndarray | None = None
    # ADTOF 프레임별 확신 점수 (프레임, 5) float32. 없으면 None (옛 파일)
    activations: np.ndarray | None = None

    def peaks_as_lists(self) -> dict[int, list[float]]:
        """assign_pads가 받는 {피치: 시각 목록} 형태."""
        return {int(p): [float(t) for t in times] for p, times in self.peaks.items()}


def _safe_name(song_id: str) -> str:
    return song_id.replace("/", "__").replace("\\", "__")


def feature_path(root: Path, dataset_name: str, song_id: str) -> Path:
    return Path(root) / dataset_name / f"{_safe_name(song_id)}.npz"


def input_as_feature(audio: np.ndarray) -> np.ndarray:
    """어댑터 입력 (채널, 샘플) → RuleFeatures.input_audio 형태 (1, 샘플) float16."""
    return to_mono(np.asarray(audio)).astype(STEM_DTYPE)[None, :]


def make_features(
    peaks: dict[int, Sequence[float]],
    stems: dict[str, np.ndarray],
    sample_rate: int,
    duration_sec: float,
    meta: dict | None = None,
    activations: np.ndarray | None = None,
) -> RuleFeatures:
    """어댑터 출력(피치별 시각, 스템 (채널, 샘플), 프레임별 점수)을 저장 형태로. 스템은 모노 float16."""
    return RuleFeatures(
        peaks={int(p): np.asarray(list(t), dtype=np.float64) for p, t in peaks.items()},
        stems={name: to_mono(np.asarray(a)).astype(STEM_DTYPE) for name, a in stems.items()},
        sample_rate=int(sample_rate),
        duration_sec=float(duration_sec),
        meta=dict(meta or {}),
        activations=None if activations is None else np.asarray(activations, dtype=np.float32),
    )


def save_features(path: Path, f: RuleFeatures) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    arrays: dict[str, np.ndarray] = {
        "sample_rate": np.asarray(f.sample_rate),
        "duration_sec": np.asarray(f.duration_sec),
        "meta": np.asarray(json.dumps(f.meta, ensure_ascii=False)),
    }
    for pitch, times in f.peaks.items():
        arrays[f"peaks_{int(pitch)}"] = np.asarray(times, dtype=np.float64)
    for name, audio in f.stems.items():
        arrays[f"stem_{name}"] = np.asarray(audio, dtype=STEM_DTYPE)
    if f.activations is not None:
        arrays["activations"] = np.asarray(f.activations, dtype=STEM_DTYPE)
    tmp = path.with_suffix(".npz.part")
    with open(tmp, "wb") as fh:
        np.savez(fh, **arrays)
    tmp.replace(path)
    return path


def load_features(path: Path) -> RuleFeatures:
    with np.load(path, allow_pickle=False) as z:
        peaks = {
            int(k.split("_", 1)[1]): np.asarray(z[k], dtype=np.float64)
            for k in z.files
            if k.startswith("peaks_")
        }
        stems = {
            k.split("_", 1)[1]: np.asarray(z[k], dtype=np.float32)[None, :]
            for k in z.files
            if k.startswith("stem_")
        }
        return RuleFeatures(
            peaks=peaks,
            stems=stems,
            sample_rate=int(z["sample_rate"]),
            duration_sec=float(z["duration_sec"]),
            meta=json.loads(str(z["meta"])),
            activations=(
                np.asarray(z["activations"], dtype=np.float32) if "activations" in z.files else None
            ),
        )


def features_from_adapter(
    tr, audio: np.ndarray, sample_rate: int, stems: dict[str, np.ndarray] | None = None
) -> RuleFeatures:
    """ADTOF + 드럼 킷 분리 어댑터(로드된 상태)로 곡 하나의 특징 계산. 벤치마크와 같은 타격·트랙.

    stems를 주면 드럼 킷 분리를 돌리지 않고 그것을 씀 (채보 모델 가중치만 바꿔 다시 저장할 때, 작업 18).
    """
    audio = np.ascontiguousarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = np.stack([audio, audio])
    activations = tr._adtof.activations(audio, sample_rate)
    peaks = tr._adtof.peaks(activations)
    all_stems = dict(stems) if stems is not None else tr.stems(audio, sample_rate)
    names = tr.rules["stems"]
    wanted = {names["toms"], names["crash"], names["ride"]}
    missing = sorted(wanted - set(all_stems))
    if missing:
        raise KeyError(f"드럼 킷 분리 출력에 스템이 없음: {missing} (있는 것: {sorted(all_stems)})")
    # 규칙이 쓰는 셋뿐 아니라 분리 트랙 전부 저장 (거르기 분모·낮은 탐 판단에 kick·snare·hh가 필요)
    stems = {n: all_stems[n] for n in sorted(all_stems)}
    meta = {
        "model": tr.name,
        "checkpoint": tr._checkpoint_id(),
        "configHash": tr.config.config_hash,
        "rulesDefault": tr.rules,
        "stemsReused": stems is not None,
    }
    return make_features(
        peaks, stems, sample_rate, audio.shape[1] / sample_rate, meta, activations=activations
    )


@dataclass
class BuildResult:
    paths: list[Path] = field(default_factory=list)
    n_skipped: int = 0
    n_failed: int = 0
    errors: dict[str, str] = field(default_factory=dict)


def reusable_stems(
    stems_from: Path | None, dataset_name: str, song_id: str
) -> dict[str, np.ndarray] | None:
    """stems_from 폴더에 같은 곡의 특징 파일이 있으면 그 분리 트랙을 돌려줌. 없으면 None."""
    if stems_from is None:
        return None
    path = feature_path(stems_from, dataset_name, song_id)
    if not path.is_file():
        return None
    return load_features(path).stems


def build_features(
    model_config: Path,
    dataset_config: Path,
    root: Path = FEATURES_ROOT,
    device: str = "cuda",
    overwrite: bool = False,
    log: Logger = print,
    stems_from: Path | None = None,
) -> BuildResult:
    """데이터셋의 모든 곡에 대해 정답 드럼 트랙 입력으로 특징을 계산해 저장. 있으면 건너뜀.

    stems_from을 주면 그 폴더의 같은 곡 특징에서 분리 트랙을 복사하고 채보 모델만 다시 돌림
    (파인튜닝 가중치 평가용. 분리 결과는 채보 모델과 무관하게 같으므로 GPU 시간을 아낌).
    """
    from ssaplash_ai.bench.runner.run_support import format_error

    config = TranscriberConfig.from_yaml(model_config)
    if config.adapter != "adtof_drumsep":
        raise ValueError(
            f"rule-features는 adtof_drumsep 어댑터만 지원: {config.name} ({config.adapter})"
        )
    dataset = load_dataset(DatasetConfig.from_yaml(dataset_config))
    device = resolve_device(device, log)
    result = BuildResult()
    song_ids = dataset.song_ids()
    todo = [s for s in song_ids if overwrite or not feature_path(root, dataset.name, s).is_file()]
    result.n_skipped = len(song_ids) - len(todo)
    log(f"[rule-features] {dataset.name}: 곡 {len(song_ids)}개, 이미 있음 {result.n_skipped}개")
    if not todo:
        return result
    tr = create_transcriber(config, device)
    try:
        load_sec = tr.load()
        log(f"[rule-features] {tr.name} 로드 {load_sec:.1f}s, 장치 {device}")
        for song_id in todo:
            path = feature_path(root, dataset.name, song_id)
            start = time.perf_counter()
            try:
                song = dataset.load(song_id)
                reuse = reusable_stems(stems_from, dataset.name, song_id)
                f = features_from_adapter(tr, song.drums_true, song.sample_rate, stems=reuse)
                save_features(path, f)
                result.paths.append(path)
                n_tom = len(f.peaks.get(47, ()))
                n_cym = len(f.peaks.get(49, ()))
                note = " 분리 트랙 재사용" if reuse is not None else ""
                log(
                    f"[rule-features] {song_id}: 탐 {n_tom}·심벌 {n_cym}{note} "
                    f"({time.perf_counter() - start:.1f}s)"
                )
            except Exception as exc:
                result.n_failed += 1
                result.errors[song_id] = format_error(exc)
                log(f"[rule-features] {song_id}: 실패 {result.errors[song_id]}")
    finally:
        tr.close()
    return result


__all__ = [
    "ADTOF_PITCHES",
    "FEATURES_ROOT",
    "BuildResult",
    "RuleFeatures",
    "build_features",
    "feature_path",
    "features_from_adapter",
    "load_features",
    "make_features",
    "reusable_stems",
    "save_features",
]
