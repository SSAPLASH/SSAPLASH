"""벤치마크 러너 (설계 4-1절). 모델 × 곡 반복 실행, 예외 격리, 결과 행 생성.

흐름: 모델마다 어댑터 생성·load(loadSec) → 곡마다 separate(시간·메모리 측정) → 예측 반주 =
원곡 − 예측 드럼 → 지표 네 묶음 → 행을 CSV에 즉시 추가 → 선택 시 wav 저장 → 어댑터 해제.
곡 하나가 실패하면 error 열에 적고 다음 곡으로. 모델 로드가 실패하면 그 모델의 모든 곡에 같은 error.
로드 직후 첫 곡을 한 번 분리하고 버림(워밍업). msst가 cudnn.benchmark를 켜서 입력 모양마다 커널
자동 조정이 돌기 때문에 무음 2초·12초 워밍업으로는 첫 곡 RTF가 나머지의 5~8배였음. 첫 곡 자체로
워밍업하면 그 곡의 모양이 미리 조정됨. 모델당 분리 1회가 추가됨.
이어하기(설계 #7-1): --run-id를 지정했고 그 폴더에 results.csv가 있으면 error가 빈 (dataset, model, songId)
행은 건너뛰고 유지, error가 있던 행은 지우고 다시 돌림. 한 모델의 곡이 전부 끝나 있으면 로드·워밍업도 생략.
열 구성이 지금 CSV_COLUMNS와 다르면 다른 버전의 결과이므로 중단.
CSV 열 이름은 설계 3-3절 camelCase 그대로. 지표 정의는 metrics 패키지가 담당.
runId·host·장치 판정·CSV 쓰기·이어하기 읽기는 run_support(채보 러너와 공용)에서 가져옴.
"""

from __future__ import annotations

import datetime as dt
import math
import traceback
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets import (
    BaseDataset,
    DatasetConfig,
    SongItem,
    load_dataset,
    write_audio,
)
from ssaplash_ai.bench.metrics import (
    attack_slope_distortion,
    bss_metrics,
    detect_onsets,
    measure_resources,
    merge_onsets,
    onset_metrics,
)
from ssaplash_ai.bench.metrics.resource_usage import gpu_name
from ssaplash_ai.bench.runner import run_support
from ssaplash_ai.bench.runner.run_support import (
    Logger,
    detect_host,
    format_error,
    new_run_id,
    resolve_device,
)
from ssaplash_ai.bench.separators import BaseSeparator, SeparatorConfig, create_separator

CSV_COLUMNS: tuple[str, ...] = (
    # 실행 식별
    "runId",
    "timestamp",
    "device",
    "gpuName",
    "host",
    # 모델 식별
    "model",
    "checkpoint",
    "configHash",
    "adapter",
    "nParams",
    "licenseCode",
    "licenseWeights",
    # 곡 식별
    "dataset",
    "songId",
    "durationSec",
    # BSS (dB)
    "sdrDrums",
    "sdrAccomp",
    "siSdrDrums",
    "siSdrAccomp",
    "sirDrums",
    "sirAccomp",
    "sarDrums",
    "sarAccomp",
    # 온셋 보존율
    "onsetF1",
    "onsetPrecision",
    "onsetRecall",
    "onsetF1Tight",
    "onsetTrueCount",
    "onsetPredCount",
    # attack slope 왜곡
    "attackSlopeDistortion",
    "attackOnsetsUsed",
    # 자원
    "separateSec",
    "rtf",
    "loadSec",
    "peakRamMb",
    "peakVramMb",
    # 실패
    "error",
)

METRIC_COLUMNS: tuple[str, ...] = (
    "sdrDrums",
    "sdrAccomp",
    "siSdrDrums",
    "siSdrAccomp",
    "sirDrums",
    "sirAccomp",
    "sarDrums",
    "sarAccomp",
    "onsetF1",
    "onsetPrecision",
    "onsetRecall",
    "onsetF1Tight",
    "attackSlopeDistortion",
    "separateSec",
    "rtf",
    "loadSec",
    "peakRamMb",
    "peakVramMb",
)

RESULTS_CSV = "results.csv"
SEPARATED_DIR = "separated"
RESUME_KEY: tuple[str, ...] = ("dataset", "model", "songId")


@dataclass
class RunOptions:
    """run 명령 입력 (설계 3-6절)."""

    model_configs: Sequence[Path]
    dataset_config: Path
    out_dir: Path
    device: str = "cuda"
    clip: tuple[float, float] | None = None
    save_wav: int = 0
    run_id: str | None = None
    warmup: bool = True


@dataclass
class RunResult:
    run_id: str
    run_dir: Path
    csv_path: Path
    rows: list[dict] = field(default_factory=list)
    device: str = "cuda"
    gpu_name: str = ""
    host: str = "local"
    n_songs: int = 0
    models: list[str] = field(default_factory=list)
    n_skipped: int = 0
    n_retried: int = 0

    @property
    def n_errors(self) -> int:
        return sum(1 for r in self.rows if r.get("error"))


def _nan_row() -> dict:
    return {c: math.nan for c in METRIC_COLUMNS}


_format_error = format_error


class CsvWriter(run_support.CsvWriter):
    """분리 결과 CSV(CSV_COLUMNS) 전용 쓰기."""

    def __init__(self, path: Path, keep_rows: Sequence[dict] | None = None) -> None:
        super().__init__(path, CSV_COLUMNS, keep_rows)


RowKey = tuple[str, str, str]


def row_key(row: dict) -> RowKey:
    """이어하기 판단 단위 (dataset, model, songId)."""
    return run_support.row_key(row, RESUME_KEY)  # type: ignore[return-value]


def load_resume_rows(csv_path: Path) -> tuple[list[dict], int]:
    """기존 results.csv에서 유지할 행(error 없음)과 다시 돌릴 행 수(error 있음). 열이 다르면 오류."""
    return run_support.load_resume_rows(csv_path, CSV_COLUMNS, RESUME_KEY)


def true_onsets(song: SongItem) -> np.ndarray:
    """정답 온셋. 합성곡은 MIDI, MUSDB는 정답 드럼 스템에 검출기 적용 (설계 3-5절).

    MIDI·사람 주석 정답은 동시 타격이 같은 시각으로 여러 번 들어 있어 30ms 안 시각을 하나로 합침.
    """
    if song.onsets_true is not None:
        return merge_onsets(song.onsets_true)
    return detect_onsets(song.drums_true, song.sample_rate)


def evaluate_song(
    song: SongItem,
    drums_pred: np.ndarray,
    onsets_true: np.ndarray,
) -> dict:
    """곡 하나의 지표 네 묶음을 3-3절 열 이름의 dict로. 예측 반주 = 원곡 − 예측 드럼."""
    accomp_pred = song.mixture - drums_pred
    bss = bss_metrics(song.drums_true, song.accomp_true, drums_pred, accomp_pred, song.sample_rate)
    onset = onset_metrics(onsets_true, drums_pred, song.sample_rate)
    transient = attack_slope_distortion(song.drums_true, drums_pred, onsets_true, song.sample_rate)
    return {
        "sdrDrums": bss.sdr_drums,
        "sdrAccomp": bss.sdr_accomp,
        "siSdrDrums": bss.si_sdr_drums,
        "siSdrAccomp": bss.si_sdr_accomp,
        "sirDrums": bss.sir_drums,
        "sirAccomp": bss.sir_accomp,
        "sarDrums": bss.sar_drums,
        "sarAccomp": bss.sar_accomp,
        "onsetF1": onset.f1,
        "onsetPrecision": onset.precision,
        "onsetRecall": onset.recall,
        "onsetF1Tight": onset.f1_tight,
        "onsetTrueCount": onset.n_true,
        "onsetPredCount": onset.n_pred,
        "attackSlopeDistortion": transient.distortion,
        "attackOnsetsUsed": transient.n_used,
    }


def _save_separated(run_dir: Path, model: str, song: SongItem, drums_pred: np.ndarray) -> None:
    d = run_dir / SEPARATED_DIR / model / song.song_id
    write_audio(d / "drums.wav", drums_pred, song.sample_rate)
    write_audio(d / "accomp.wav", song.mixture - drums_pred, song.sample_rate)


def _dataset_with_clip(config_path: Path, clip: tuple[float, float] | None) -> BaseDataset:
    config = DatasetConfig.from_yaml(config_path)
    if clip is not None:
        config.clip = clip
    return load_dataset(config)


def _model_rows_base(
    result: RunResult, sep: BaseSeparator, timestamp: str, load_sec: float | None
) -> dict:
    info = sep.info()
    return {
        "runId": result.run_id,
        "timestamp": timestamp,
        "device": sep.device,
        "gpuName": result.gpu_name,
        "host": result.host,
        "model": info.name,
        "checkpoint": info.checkpoint,
        "configHash": sep.config.config_hash,
        "adapter": info.adapter,
        "nParams": info.n_params if info.n_params is not None else "",
        "licenseCode": info.license_code,
        "licenseWeights": info.license_weights,
        "loadSec": load_sec if load_sec is not None else math.nan,
    }


def warmup_run(
    sep: BaseSeparator, dataset: BaseDataset, song_ids: Sequence[str], log: Logger
) -> None:
    """첫 곡을 한 번 분리하고 버림. 실패해도 본 측정에는 영향 없음(본 측정에서 다시 error로 잡힘)."""
    if not song_ids:
        return
    try:
        song = dataset.load(song_ids[0])
        with measure_resources(sep.device) as usage:
            sep.separate(song.mixture, song.sample_rate)
        log(f"[{sep.name}] 워밍업 {usage.elapsed_sec:.1f}s ({song.song_id})")
    except Exception as exc:
        log(f"[{sep.name}] 워밍업 실패 (무시): {_format_error(exc)}")


def run_model(
    sep: BaseSeparator,
    dataset: BaseDataset,
    result: RunResult,
    writer: CsvWriter,
    save_wav: int,
    onset_cache: dict[str, np.ndarray],
    log: Logger,
    warmup: bool = True,
    done_song_ids: frozenset[str] = frozenset(),
) -> None:
    """모델 하나를 데이터셋 전체에 돌림. 행마다 CSV에 즉시 기록.

    done_song_ids에 든 곡은 이미 끝난 것으로 보고 건너뜀(이어하기). 전부 끝나 있으면 로드도 생략.
    """
    timestamp = dt.datetime.now().isoformat(timespec="seconds")
    all_ids = dataset.song_ids()
    song_ids = [s for s in all_ids if s not in done_song_ids]
    if done_song_ids:
        log(
            f"[{sep.name}] 이어하기: 건너뜀 {len(all_ids) - len(song_ids)}곡, 남은 {len(song_ids)}곡"
        )
    if not song_ids:
        return
    try:
        load_sec = sep.load()
        log(f"[{sep.name}] 로드 {load_sec:.1f}s, 장치 {sep.device}")
        if warmup:
            warmup_run(sep, dataset, song_ids, log)
    except Exception as exc:  # 모델 로드 실패: 모든 곡에 같은 error
        err = _format_error(exc)
        log(f"[{sep.name}] 로드 실패: {err}")
        base = _model_rows_base(result, sep, timestamp, None)
        for song_id in song_ids:
            row = {**_nan_row(), **base, "dataset": dataset.name, "songId": song_id}
            row.update(durationSec=math.nan, error=err)
            writer.write(row)
            result.rows.append(row)
        return

    base = _model_rows_base(result, sep, timestamp, load_sec)
    saved = 0
    for song_id in song_ids:
        row = {**_nan_row(), **base, "dataset": dataset.name, "songId": song_id, "error": ""}
        try:
            song = dataset.load(song_id)
            row["durationSec"] = song.duration_sec
            with measure_resources(sep.device) as usage:
                out = sep.separate(song.mixture, song.sample_rate)
            row.update(
                separateSec=usage.elapsed_sec,
                rtf=usage.elapsed_sec / song.duration_sec if song.duration_sec else math.nan,
                peakRamMb=usage.peak_ram_mb,
                peakVramMb=usage.peak_vram_mb,
            )
            if song_id not in onset_cache:
                onset_cache[song_id] = true_onsets(song)
            row.update(evaluate_song(song, out.drums, onset_cache[song_id]))
            if saved < save_wav:
                _save_separated(result.run_dir, sep.name, song, out.drums)
                saved += 1
            log(
                f"[{sep.name}] {song_id}: sdrDrums={row['sdrDrums']:.2f} "
                f"onsetF1={row['onsetF1']:.3f} rtf={row['rtf']:.3f}"
            )
        except Exception as exc:
            row["error"] = _format_error(exc)
            log(f"[{sep.name}] {song_id}: 실패 {row['error']}")
            log(traceback.format_exc(limit=3))
        writer.write(row)
        result.rows.append(row)


def run_benchmark(opts: RunOptions, log: Logger = print) -> RunResult:
    """설계 4-1절 1~4단계. 보고서·MLflow 기록(5단계)은 cli가 report·tracking으로 이어서 함."""
    run_id = opts.run_id or new_run_id()
    run_dir = Path(opts.out_dir) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    device = resolve_device(opts.device, log)
    dataset = _dataset_with_clip(Path(opts.dataset_config), opts.clip)
    configs = [SeparatorConfig.from_yaml(p) for p in opts.model_configs]
    result = RunResult(
        run_id=run_id,
        run_dir=run_dir,
        csv_path=run_dir / RESULTS_CSV,
        device=device,
        gpu_name=gpu_name(device),
        host=detect_host(),
        n_songs=len(dataset),
        models=[c.name for c in configs],
    )
    log(
        f"run {run_id}: 모델 {len(configs)}개 × 곡 {result.n_songs}개 "
        f"({dataset.name}), 장치 {device} {result.gpu_name}, 호스트 {result.host}"
    )
    keep_rows: list[dict] | None = None
    if opts.run_id and result.csv_path.exists():
        keep_rows, result.n_retried = load_resume_rows(result.csv_path)
        result.n_skipped = len(keep_rows)
        result.rows.extend(keep_rows)
        log(
            f"run {run_id}: 이어하기. 기존 성공 {result.n_skipped}행 유지, "
            f"실패 {result.n_retried}행 다시 실행"
        )
    done_by_model: dict[str, set[str]] = {}
    for row in keep_rows or []:
        ds_name, model, song_id = row_key(row)
        if ds_name == dataset.name:
            done_by_model.setdefault(model, set()).add(song_id)
    writer = CsvWriter(result.csv_path, keep_rows)
    onset_cache: dict[str, np.ndarray] = {}
    try:
        for config in configs:
            sep = create_separator(config, device)
            try:
                run_model(
                    sep,
                    dataset,
                    result,
                    writer,
                    opts.save_wav,
                    onset_cache,
                    log,
                    opts.warmup,
                    frozenset(done_by_model.get(config.name, ())),
                )
            finally:
                sep.close()
    finally:
        writer.close()
    log(f"run {run_id}: 행 {len(result.rows)}개, 실패 {result.n_errors}개 → {result.csv_path}")
    return result
