"""규칙 분석용 특징 저장 (탐·크래시 규칙 설계 2장·3장 "저장하는 특징").

ADTOF + 드럼 킷 분리 어댑터의 무거운 계산(ADTOF 활성값 → 피치별 타격 시각, 드럼 킷 분리 트랙)을 곡마다
한 번만 GPU로 돌려 npz 파일로 저장. 이후 규칙 후보 비교(rule_eval)·탐 음높이 분석(tom_pitch)은 이 파일만
읽어 CPU로 몇 초 안에 끝남.

저장 내용 (곡 하나 = npz 하나)
- peaks_{피치}: ADTOF가 잡은 시각(초). 피치 35 킥·38 스네어·42 하이햇·47 탐·49 심벌
- stem_{이름}: 드럼 킷 분리 트랙 중 규칙이 쓰는 toms·crash·ride. 모노 float16, 샘플레이트는 입력과 같음(44.1kHz).
  float16은 float32의 절반 크기이고 규칙(스펙트럼 봉우리·에너지 비교)에는 차이가 거의 없음
- sample_rate, duration_sec, meta(json: 모델·checkpoint·설정 해시·기본 규칙)
경로 `data/rule_features/{데이터셋}/{곡}.npz`. 이미 있으면 건너뜀. `data/`는 git 미추적.
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
    """곡 하나의 저장 특징. stems 값은 (1, 샘플) float32로 돌려줌 (규칙 함수가 (채널, 샘플)을 받음)."""

    peaks: dict[int, np.ndarray]
    stems: dict[str, np.ndarray]
    sample_rate: int
    duration_sec: float
    meta: dict = field(default_factory=dict)

    def peaks_as_lists(self) -> dict[int, list[float]]:
        """assign_pads가 받는 {피치: 시각 목록} 형태."""
        return {int(p): [float(t) for t in times] for p, times in self.peaks.items()}


def _safe_name(song_id: str) -> str:
    return song_id.replace("/", "__").replace("\\", "__")


def feature_path(root: Path, dataset_name: str, song_id: str) -> Path:
    return Path(root) / dataset_name / f"{_safe_name(song_id)}.npz"


def make_features(
    peaks: dict[int, Sequence[float]],
    stems: dict[str, np.ndarray],
    sample_rate: int,
    duration_sec: float,
    meta: dict | None = None,
) -> RuleFeatures:
    """어댑터 출력(피치별 시각, 스템 (채널, 샘플))을 저장 형태로. 스템은 모노 float16."""
    return RuleFeatures(
        peaks={int(p): np.asarray(list(t), dtype=np.float64) for p, t in peaks.items()},
        stems={name: to_mono(np.asarray(a)).astype(STEM_DTYPE) for name, a in stems.items()},
        sample_rate=int(sample_rate),
        duration_sec=float(duration_sec),
        meta=dict(meta or {}),
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
        )


def features_from_adapter(tr, audio: np.ndarray, sample_rate: int) -> RuleFeatures:
    """ADTOF + 드럼 킷 분리 어댑터(로드된 상태)로 곡 하나의 특징 계산. 벤치마크와 같은 타격·트랙."""
    audio = np.ascontiguousarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = np.stack([audio, audio])
    peaks = tr._adtof.peaks(tr._adtof.activations(audio, sample_rate))
    all_stems = tr.stems(audio, sample_rate)
    names = tr.rules["stems"]
    wanted = {names["toms"], names["crash"], names["ride"]}
    missing = sorted(wanted - set(all_stems))
    if missing:
        raise KeyError(f"드럼 킷 분리 출력에 스템이 없음: {missing} (있는 것: {sorted(all_stems)})")
    stems = {n: all_stems[n] for n in sorted(wanted)}
    meta = {
        "model": tr.name,
        "checkpoint": tr._checkpoint_id(),
        "configHash": tr.config.config_hash,
        "rulesDefault": tr.rules,
    }
    return make_features(peaks, stems, sample_rate, audio.shape[1] / sample_rate, meta)


@dataclass
class BuildResult:
    paths: list[Path] = field(default_factory=list)
    n_skipped: int = 0
    n_failed: int = 0
    errors: dict[str, str] = field(default_factory=dict)


def build_features(
    model_config: Path,
    dataset_config: Path,
    root: Path = FEATURES_ROOT,
    device: str = "cuda",
    overwrite: bool = False,
    log: Logger = print,
) -> BuildResult:
    """데이터셋의 모든 곡에 대해 정답 드럼 트랙 입력으로 특징을 계산해 저장. 있으면 건너뜀."""
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
                f = features_from_adapter(tr, song.drums_true, song.sample_rate)
                save_features(path, f)
                result.paths.append(path)
                n_tom = len(f.peaks.get(47, ()))
                n_cym = len(f.peaks.get(49, ()))
                log(
                    f"[rule-features] {song_id}: 탐 {n_tom}·심벌 {n_cym} "
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
    "save_features",
]
