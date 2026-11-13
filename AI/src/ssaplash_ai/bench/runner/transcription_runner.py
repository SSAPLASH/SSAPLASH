"""채보 벤치마크 러너. 채보 모델 × 곡 반복 실행, 예외 격리, 결과 행 생성.

흐름: 모델마다 어댑터 생성·load·워밍업 → 곡마다 입력 고르기(drums / mixture / separated) → transcribe
→ hit_f1 점수 → results.csv 1행 + hits_by_class.csv 여러 행 즉시 기록 → 어댑터 해제.
separated는 run 폴더 `separated/<분리 모델>/<곡>/drums.wav`에 캐시하고 있으면 분리를 건너뜀.
이어하기 키는 (dataset, model, input, separator, songId). 열 구성이 다르면 중단.
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
    read_audio,
    write_audio,
)
from ssaplash_ai.bench.metrics import HitEvaluation, HitScores, evaluate_hits, measure_resources
from ssaplash_ai.bench.metrics.resource_usage import cuda_available, gpu_name
from ssaplash_ai.bench.runner.run_support import (
    CsvWriter,
    Logger,
    detect_host,
    format_error,
    load_resume_rows,
    new_run_id,
    resolve_device,
    row_key,
)
from ssaplash_ai.bench.separators import BaseSeparator, SeparatorConfig, create_separator
from ssaplash_ai.bench.transcribers import (
    BaseTranscriber,
    BatchItem,
    TranscriberConfig,
    TranscriptionResult,
    create_transcriber,
    hits_to_midi,
)

INPUTS: tuple[str, ...] = ("drums", "mixture", "separated")

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
    "eightPad",
    "hasVelocity",
    # 입력
    "input",
    "separator",
    "separateSec",
    # 곡 식별
    "dataset",
    "songId",
    "durationSec",
    # 타격 수
    "hitsTrue",
    "hitsPred",
    "hitsPredDropped",
    # 5가지 기준 개수·곡 단위 값
    "tpFive50",
    "fpFive50",
    "fnFive50",
    "tpFive25",
    "fpFive25",
    "fnFive25",
    "f1Five50",
    "precFive50",
    "recFive50",
    "f1Five25",
    # 8패드 기준 (eightPad 거짓이면 NaN)
    "tpPads50",
    "fpPads50",
    "fnPads50",
    "tpPads25",
    "fpPads25",
    "fnPads25",
    "f1Pads50",
    "precPads50",
    "recPads50",
    "f1Pads25",
    # 보조
    "perfectRatio",
    "meanErrMs",
    "meanAbsErrMs",
    "f1Any50",
    "velocityCorr",
    # 자원
    "transcribeSec",
    "rtf",
    "loadSec",
    "peakRamMb",
    "peakVramMb",
    "vramMethod",
    # 실패
    "error",
)

METRIC_COLUMNS: tuple[str, ...] = tuple(
    c
    for c in CSV_COLUMNS
    if c.startswith(("tp", "fp", "fn", "f1", "prec", "rec"))
    or c
    in (
        "perfectRatio",
        "meanErrMs",
        "meanAbsErrMs",
        "velocityCorr",
        "transcribeSec",
        "rtf",
        "loadSec",
        "peakRamMb",
        "peakVramMb",
        "separateSec",
    )
)

HITS_BY_CLASS_COLUMNS: tuple[str, ...] = (
    "runId",
    "model",
    "input",
    "separator",
    "dataset",
    "songId",
    "scheme",
    "label",
    "windowMs",
    "tp",
    "fp",
    "fn",
)

RESUME_KEY: tuple[str, ...] = ("dataset", "model", "input", "separator", "songId")
RESULTS_CSV = "results.csv"
HITS_CSV = "hits_by_class.csv"
SEPARATED_DIR = "separated"
MIDI_DIR = "midi"
INPUTS_DIR = "inputs"


@dataclass
class TranscriptionRunOptions:
    """run-transcription 명령 입력."""

    model_configs: Sequence[Path]
    dataset_config: Path
    out_dir: Path
    device: str = "cuda"
    input: str = "drums"
    separator_config: Path | None = None
    separated_dir: Path | None = None
    clip: tuple[float, float] | None = None
    save_midi: int = 0
    run_id: str | None = None
    warmup: bool = True


@dataclass
class TranscriptionRunResult:
    run_id: str
    run_dir: Path
    csv_path: Path
    hits_csv_path: Path
    rows: list[dict] = field(default_factory=list)
    device: str = "cuda"
    gpu_name: str = ""
    host: str = "local"
    input: str = "drums"
    separator: str = ""
    n_songs: int = 0
    models: list[str] = field(default_factory=list)
    n_skipped: int = 0
    n_retried: int = 0

    @property
    def n_errors(self) -> int:
        return sum(1 for r in self.rows if r.get("error"))


def _nan_row() -> dict:
    return {c: math.nan for c in METRIC_COLUMNS}


# ---------- 입력 고르기 ----------


class InputSource:
    """곡의 입력 배열을 고름. separated는 디스크 캐시 → 없으면 분리 어댑터."""

    def __init__(
        self,
        kind: str,
        separator: BaseSeparator | None,
        separated_root: Path | None,
        device: str,
        log: Logger,
    ) -> None:
        if kind not in INPUTS:
            raise ValueError(f"input은 {INPUTS} 중 하나: {kind}")
        self.kind = kind
        self.separator = separator
        self.separated_root = separated_root
        self.device = device
        self.log = log
        self._sep_loaded = False

    @property
    def separator_name(self) -> str:
        if self.separator is not None:
            return self.separator.name
        if self.separated_root is not None:
            return self.separated_root.name
        return ""

    def cache_path(self, song_id: str) -> Path:
        assert self.separated_root is not None
        return self.separated_root / song_id / "drums.wav"

    def get(self, song: SongItem) -> tuple[np.ndarray, float]:
        """(입력 배열, 분리 시간 초). 분리를 안 했으면 nan."""
        if self.kind == "drums":
            return song.drums_true, math.nan
        if self.kind == "mixture":
            return song.mixture, math.nan
        path = self.cache_path(song.song_id)
        if path.is_file():
            audio = read_audio(path, song.sample_rate)
            if audio.shape[1] != song.mixture.shape[1]:
                raise ValueError(
                    f"캐시된 분리 드럼 길이가 곡과 다름: {path} ({audio.shape[1]} vs {song.mixture.shape[1]})"
                )
            return audio, math.nan
        if self.separator is None:
            raise FileNotFoundError(f"분리된 드럼 wav가 없고 --separator도 없음: {path}")
        if not self._sep_loaded:
            load_sec = self.separator.load()
            self.log(f"[분리 {self.separator.name}] 로드 {load_sec:.1f}s")
            self._sep_loaded = True
        with measure_resources(self.device) as usage:
            out = self.separator.separate(song.mixture, song.sample_rate)
        write_audio(path, out.drums, song.sample_rate)
        return out.drums, usage.elapsed_sec

    def close(self) -> None:
        if self.separator is not None and self._sep_loaded:
            self.separator.close()
            self._sep_loaded = False


# ---------- 지표 → 행 ----------


def _scores_columns(prefix: str, s: HitScores | None) -> dict:
    if s is None:
        return {}
    return {
        f"tp{prefix}50": s.counts.tp,
        f"fp{prefix}50": s.counts.fp,
        f"fn{prefix}50": s.counts.fn,
        f"tp{prefix}25": s.counts_tight.tp,
        f"fp{prefix}25": s.counts_tight.fp,
        f"fn{prefix}25": s.counts_tight.fn,
        f"f1{prefix}50": s.f1,
        f"prec{prefix}50": s.counts.precision,
        f"rec{prefix}50": s.counts.recall,
        f"f1{prefix}25": s.f1_tight,
    }


def evaluation_columns(ev: HitEvaluation, result: TranscriptionResult, song: SongItem) -> dict:
    """곡 하나의 지표를 CSV 열 이름 dict로."""
    main = ev.pads if ev.pads is not None else ev.five
    row = {
        "hitsTrue": int(len(song.hits_true)) if song.hits_true is not None else 0,
        "hitsPred": int(len(result.hits_pred)),
        "hitsPredDropped": int(result.hits_pred_dropped),
        "perfectRatio": main.perfect_ratio,
        "meanErrMs": main.mean_err_ms,
        "meanAbsErrMs": main.mean_abs_err_ms,
        "f1Any50": ev.any.f1,
        "velocityCorr": main.velocity_corr,
    }
    row.update(_scores_columns("Five", ev.five))
    row.update(_scores_columns("Pads", ev.pads))
    return row


def hits_by_class_rows(ev: HitEvaluation, base: dict) -> list[dict]:
    """라벨별 개수 긴 형식 행. pads·pads9는 계산됐을 때만.

    pads9 기준에는 페달 혼동 수 행 두 개가 붙음: label PEDAL_AS_HIHAT(정답 페달을 HIHAT으로 냄)과
    HIHAT_AS_PEDAL(정답 HIHAT을 페달로 냄). 이 두 행은 짝 수를 tp 칸에 적고 fp·fn은 0.
    """
    rows: list[dict] = []
    if ev.pedal is not None:
        for label, n in (
            ("PEDAL_AS_HIHAT", ev.pedal.pedal_as_hihat),
            ("HIHAT_AS_PEDAL", ev.pedal.hihat_as_pedal),
        ):
            rows.append(
                {
                    **base,
                    "scheme": "pads9",
                    "label": label,
                    "windowMs": 50,
                    "tp": n,
                    "fp": 0,
                    "fn": 0,
                }
            )
    for scheme, scores in (("five", ev.five), ("pads", ev.pads), ("pads9", ev.pads9)):
        if scores is None:
            continue
        for window_ms, by_label in ((50, scores.by_label), (25, scores.by_label_tight)):
            for label, c in sorted(by_label.items()):
                rows.append(
                    {
                        **base,
                        "scheme": scheme,
                        "label": label,
                        "windowMs": window_ms,
                        "tp": c.tp,
                        "fp": c.fp,
                        "fn": c.fn,
                    }
                )
    return rows


def _model_rows_base(
    result: TranscriptionRunResult, tr: BaseTranscriber, timestamp: str, load_sec: float | None
) -> dict:
    info = tr.info()
    return {
        "runId": result.run_id,
        "timestamp": timestamp,
        "device": tr.device,
        "gpuName": result.gpu_name,
        "host": result.host,
        "model": info.name,
        "checkpoint": info.checkpoint,
        "configHash": tr.config.config_hash,
        "adapter": info.adapter,
        "nParams": info.n_params if info.n_params is not None else "",
        "licenseCode": info.license_code,
        "licenseWeights": info.license_weights,
        "eightPad": info.eight_pad,
        "hasVelocity": info.has_velocity,
        "input": result.input,
        "separator": result.separator,
        "loadSec": load_sec if load_sec is not None else math.nan,
    }


def _save_midi(run_dir: Path, model: str, song_id: str, hits: np.ndarray) -> Path:
    return hits_to_midi(hits, run_dir / MIDI_DIR / model / f"{song_id}.mid")


def warmup_run(tr: BaseTranscriber, song: SongItem, audio: np.ndarray, log: Logger) -> None:
    """첫 곡을 한 번 채보하고 버림. 실패해도 본 측정에는 영향 없음."""
    try:
        with measure_resources(tr.device) as usage:
            tr.transcribe(audio, song.sample_rate, song.song_id)
        log(f"[{tr.name}] 워밍업 {usage.elapsed_sec:.1f}s ({song.song_id})")
    except Exception as exc:
        log(f"[{tr.name}] 워밍업 실패 (무시): {format_error(exc)}")


def _safe_name(song_id: str) -> str:
    return song_id.replace("/", "__").replace("\\", "__")


def run_model_batch(
    tr: BaseTranscriber,
    dataset: BaseDataset,
    source: InputSource,
    result: TranscriptionRunResult,
    writer: CsvWriter,
    hits_writer: CsvWriter,
    save_midi: int,
    log: Logger,
    warmup: bool,
    song_ids: Sequence[str],
    timestamp: str,
) -> None:
    """external 어댑터용: 입력 wav를 run 폴더에 전부 써 둔 뒤 스크립트를 한 번 띄워 곡 목록을 통째로 넘김.

    곡 정답·길이만 메모리에 들고(오디오는 디스크) 응답을 받은 뒤 곡마다 지표를 냄.
    입력을 만들다 실패한 곡은 그 곡만 error 행.
    """
    inputs_dir = result.run_dir / INPUTS_DIR / tr.name
    inputs_dir.mkdir(parents=True, exist_ok=True)
    tr.work_dir = inputs_dir  # type: ignore[attr-defined]
    items: list[BatchItem] = []
    meta: dict[str, tuple[np.ndarray, float, float]] = {}  # song_id → (hits_true, 길이, 분리 시간)
    prep_errors: dict[str, str] = {}
    for song_id in song_ids:
        try:
            song = dataset.load(song_id)
            if song.hits_true is None:
                raise ValueError(f"{dataset.name}/{song_id}: 타격 정답(hits_true)이 없음")
            audio, separate_sec = source.get(song)
            wav = inputs_dir / f"{_safe_name(song_id)}.wav"
            write_audio(wav, audio, song.sample_rate)
            items.append(BatchItem(song_id, wav, song.duration_sec))
            meta[song_id] = (song.hits_true, song.duration_sec, separate_sec)
        except Exception as exc:
            prep_errors[song_id] = format_error(exc)
            log(f"[{tr.name}] {song_id}: 입력 준비 실패 {prep_errors[song_id]}")
    log(
        f"[{tr.name}] 별도 환경 스크립트 실행: 곡 {len(items)}개 ({tr.config.env_name or tr.config.script})"
    )
    out = tr.transcribe_files(items, warmup=warmup)  # type: ignore[attr-defined]
    if out.note:
        log(f"[{tr.name}] 스크립트 안내: {out.note}")
    base = _model_rows_base(result, tr, timestamp, out.load_sec)
    saved = 0
    for song_id in song_ids:
        row = {**_nan_row(), **base, "dataset": dataset.name, "songId": song_id, "error": ""}
        if song_id in prep_errors:
            row["error"] = prep_errors[song_id]
            writer.write(row)
            result.rows.append(row)
            continue
        hits_true, duration, separate_sec = meta[song_id]
        row["durationSec"] = duration
        row["separateSec"] = separate_sec
        res = out.results.get(song_id, "응답에 곡이 없음")
        if isinstance(res, str):
            row["error"] = res
            log(f"[{tr.name}] {song_id}: 실패 {res}")
            writer.write(row)
            result.rows.append(row)
            continue
        try:
            elapsed = res.elapsed_sec if res.elapsed_sec is not None else math.nan
            row.update(
                transcribeSec=elapsed,
                rtf=elapsed / duration if duration else math.nan,
                peakRamMb=math.nan,
                peakVramMb=res.peak_vram_mb if res.peak_vram_mb is not None else math.nan,
                vramMethod=res.vram_method or "",
            )
            song_stub = SongItem(
                dataset=dataset.name,
                song_id=song_id,
                sample_rate=dataset.config.sample_rate,
                mixture=np.zeros((2, 0), np.float32),
                drums_true=np.zeros((2, 0), np.float32),
                accomp_true=np.zeros((2, 0), np.float32),
                hits_true=hits_true,
            )
            ev = evaluate_hits(hits_true, res.hits_pred, tr.config.eight_pad)
            row.update(evaluation_columns(ev, res, song_stub))
            hits_writer.write_many(
                hits_by_class_rows(
                    ev,
                    {
                        "runId": result.run_id,
                        "model": tr.name,
                        "input": result.input,
                        "separator": result.separator,
                        "dataset": dataset.name,
                        "songId": song_id,
                    },
                )
            )
            if saved < save_midi:
                _save_midi(result.run_dir, tr.name, song_id, res.hits_pred)
                saved += 1
            pads_txt = f" f1Pads={row['f1Pads50']:.3f}" if ev.pads is not None else ""
            log(
                f"[{tr.name}] {song_id}: f1Five={row['f1Five50']:.3f}{pads_txt} rtf={row['rtf']:.3f}"
            )
        except Exception as exc:
            row["error"] = format_error(exc)
            log(f"[{tr.name}] {song_id}: 실패 {row['error']}")
            log(traceback.format_exc(limit=3))
        writer.write(row)
        result.rows.append(row)


def run_model(
    tr: BaseTranscriber,
    dataset: BaseDataset,
    source: InputSource,
    result: TranscriptionRunResult,
    writer: CsvWriter,
    hits_writer: CsvWriter,
    save_midi: int,
    log: Logger,
    warmup: bool = True,
    done_song_ids: frozenset[str] = frozenset(),
) -> None:
    """모델 하나를 데이터셋 전체에 돌림. 행마다 CSV에 즉시 기록. done_song_ids는 건너뜀(이어하기)."""
    timestamp = dt.datetime.now().isoformat(timespec="seconds")
    all_ids = dataset.song_ids()
    song_ids = [s for s in all_ids if s not in done_song_ids]
    if done_song_ids:
        log(
            f"[{tr.name}] 이어하기: 건너뜀 {len(all_ids) - len(song_ids)}곡, 남은 {len(song_ids)}곡"
        )
    if not song_ids:
        return
    vram_method = "torch" if cuda_available(tr.device) else ""
    try:
        load_sec = tr.load()
        log(f"[{tr.name}] 로드 {load_sec:.1f}s, 장치 {tr.device}")
        if warmup and not getattr(tr, "batch", False):
            first = dataset.load(song_ids[0])
            audio, _ = source.get(first)
            warmup_run(tr, first, audio, log)
    except Exception as exc:  # 모델 로드 실패: 모든 곡에 같은 error
        err = format_error(exc)
        log(f"[{tr.name}] 로드 실패: {err}")
        base = _model_rows_base(result, tr, timestamp, None)
        for song_id in song_ids:
            row = {**_nan_row(), **base, "dataset": dataset.name, "songId": song_id}
            row.update(durationSec=math.nan, error=err)
            writer.write(row)
            result.rows.append(row)
        return

    if getattr(tr, "batch", False):
        run_model_batch(
            tr,
            dataset,
            source,
            result,
            writer,
            hits_writer,
            save_midi,
            log,
            warmup,
            song_ids,
            timestamp,
        )
        return

    base = _model_rows_base(result, tr, timestamp, load_sec)
    saved = 0
    for song_id in song_ids:
        row = {**_nan_row(), **base, "dataset": dataset.name, "songId": song_id, "error": ""}
        try:
            song = dataset.load(song_id)
            if song.hits_true is None:
                raise ValueError(f"{dataset.name}/{song_id}: 타격 정답(hits_true)이 없음")
            row["durationSec"] = song.duration_sec
            audio, separate_sec = source.get(song)
            row["separateSec"] = separate_sec
            with measure_resources(tr.device) as usage:
                out = tr.transcribe(audio, song.sample_rate, song_id)
            elapsed = out.elapsed_sec if out.elapsed_sec is not None else usage.elapsed_sec
            vram = out.peak_vram_mb if out.peak_vram_mb is not None else usage.peak_vram_mb
            row.update(
                transcribeSec=elapsed,
                rtf=elapsed / song.duration_sec if song.duration_sec else math.nan,
                peakRamMb=usage.peak_ram_mb,
                peakVramMb=vram,
                vramMethod=out.vram_method if out.vram_method is not None else vram_method,
            )
            ev = evaluate_hits(song.hits_true, out.hits_pred, tr.config.eight_pad)
            row.update(evaluation_columns(ev, out, song))
            hits_writer.write_many(
                hits_by_class_rows(
                    ev,
                    {
                        "runId": result.run_id,
                        "model": tr.name,
                        "input": result.input,
                        "separator": result.separator,
                        "dataset": dataset.name,
                        "songId": song_id,
                    },
                )
            )
            if saved < save_midi:
                _save_midi(result.run_dir, tr.name, song_id, out.hits_pred)
                saved += 1
            pads_txt = f" f1Pads={row['f1Pads50']:.3f}" if ev.pads is not None else ""
            log(
                f"[{tr.name}] {song_id}: f1Five={row['f1Five50']:.3f}{pads_txt} "
                f"rtf={row['rtf']:.3f}"
            )
        except Exception as exc:
            row["error"] = format_error(exc)
            log(f"[{tr.name}] {song_id}: 실패 {row['error']}")
            log(traceback.format_exc(limit=3))
        writer.write(row)
        result.rows.append(row)


def _dataset_with_clip(config_path: Path, clip: tuple[float, float] | None) -> BaseDataset:
    config = DatasetConfig.from_yaml(config_path)
    if clip is not None:
        config.clip = clip
    return load_dataset(config)


def check_dataset_has_hits(dataset: BaseDataset) -> None:
    """첫 곡으로 타격 정답 유무 확인 (오디오는 읽지 않음)."""
    ids = dataset.song_ids()
    if not ids:
        raise ValueError(f"{dataset.name}: 곡이 없음")
    if dataset.hits_of(ids[0]) is None:
        raise ValueError(
            f"{dataset.name}: 타격 정답이 없는 데이터셋이라 채보 벤치마크에 쓸 수 없음"
        )


def build_input_source(
    opts: TranscriptionRunOptions, run_dir: Path, device: str, dataset: BaseDataset, log: Logger
) -> InputSource:
    if opts.input != "separated":
        return InputSource(opts.input, None, None, device, log)
    separator = None
    if opts.separator_config is not None:
        separator = create_separator(SeparatorConfig.from_yaml(opts.separator_config), device)
    if opts.separated_dir is not None:
        root = Path(opts.separated_dir)
    elif separator is not None:
        root = run_dir / SEPARATED_DIR / separator.name
    else:
        raise ValueError("--input separated에는 --separator 또는 --separated-dir가 필요")
    if dataset.config.kind == "gmd":
        log("경고: GMD 묶음은 반주가 무음이라 분리 드럼 입력이 정답 드럼과 거의 같음")
    return InputSource("separated", separator, root, device, log)


def run_transcription(opts: TranscriptionRunOptions, log: Logger = print) -> TranscriptionRunResult:
    """채보 벤치마크 실행. 보고서·MLflow 기록은 cli가 이어서 함."""
    run_id = opts.run_id or new_run_id()
    run_dir = Path(opts.out_dir) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    device = resolve_device(opts.device, log)
    dataset = _dataset_with_clip(Path(opts.dataset_config), opts.clip)
    check_dataset_has_hits(dataset)
    configs = [TranscriberConfig.from_yaml(p) for p in opts.model_configs]
    source = build_input_source(opts, run_dir, device, dataset, log)
    result = TranscriptionRunResult(
        run_id=run_id,
        run_dir=run_dir,
        csv_path=run_dir / RESULTS_CSV,
        hits_csv_path=run_dir / HITS_CSV,
        device=device,
        gpu_name=gpu_name(device),
        host=detect_host(),
        input=opts.input,
        separator=source.separator_name,
        n_songs=len(dataset),
        models=[c.name for c in configs],
    )
    log(
        f"run {run_id}: 채보 모델 {len(configs)}개 × 곡 {result.n_songs}개 ({dataset.name}), "
        f"입력 {opts.input}{' ' + result.separator if result.separator else ''}, "
        f"장치 {device} {result.gpu_name}, 호스트 {result.host}"
    )
    keep_rows: list[dict] | None = None
    keep_hits: list[dict] | None = None
    if opts.run_id and result.csv_path.exists():
        keep_rows, result.n_retried = load_resume_rows(result.csv_path, CSV_COLUMNS, RESUME_KEY)
        result.n_skipped = len(keep_rows)
        result.rows.extend(keep_rows)
        keep_hits = _resume_hits_rows(result.hits_csv_path, keep_rows)
        log(
            f"run {run_id}: 이어하기. 기존 성공 {result.n_skipped}행 유지, "
            f"실패 {result.n_retried}행 다시 실행"
        )
    done_by_model: dict[str, set[str]] = {}
    for row in keep_rows or []:
        ds_name, model, inp, sep, song_id = row_key(row, RESUME_KEY)
        if ds_name == dataset.name and inp == result.input and sep == result.separator:
            done_by_model.setdefault(model, set()).add(song_id)
    writer = CsvWriter(result.csv_path, CSV_COLUMNS, keep_rows)
    hits_writer = CsvWriter(result.hits_csv_path, HITS_BY_CLASS_COLUMNS, keep_hits)
    try:
        for config in configs:
            tr = create_transcriber(config, device)
            try:
                run_model(
                    tr,
                    dataset,
                    source,
                    result,
                    writer,
                    hits_writer,
                    opts.save_midi,
                    log,
                    opts.warmup,
                    frozenset(done_by_model.get(config.name, ())),
                )
            finally:
                tr.close()
    finally:
        source.close()
        writer.close()
        hits_writer.close()
    log(f"run {run_id}: 행 {len(result.rows)}개, 실패 {result.n_errors}개 → {result.csv_path}")
    return result


def _resume_hits_rows(hits_csv_path: Path, keep_rows: Sequence[dict]) -> list[dict]:
    """이어하기: 유지하는 results 행에 딸린 hits_by_class 행만 남김."""
    if not hits_csv_path.exists():
        return []
    from ssaplash_ai.bench.runner.run_support import read_csv_rows

    keys = {row_key(r, RESUME_KEY) for r in keep_rows}
    return [r for r in read_csv_rows(hits_csv_path) if row_key(r, RESUME_KEY) in keys]
