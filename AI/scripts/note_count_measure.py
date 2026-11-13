"""채보 뒤 노트 수 기준값(`drum_check.min_notes_per_minute`)을 정하려고 파일마다 1분당 노트 수를 측정하는 스크립트.

드럼 있는 곡과 드럼 없는 음원을 서비스와 같은 분리 → 채보로 돌려 1분당 노트 수를 CSV로 남김. 두 쪽이 얼마나
떨어져 있는지 보고 기준값을 정함. 입력 폴더는 `scripts/note_count_inputs.py`가 만든 묶음(집합 이름 폴더 아래 음원 파일).

  # GPU 서버 (notebooks/note_count_threshold_server.ipynb가 부름. AI/ 폴더에서)
  python scripts/note_count_measure.py --inputs ~/ssaplash/upload/note_count_inputs --out ~/ssaplash/results/note-count
  # 결과 CSV만 다시 요약 (로컬)
  uv run python scripts/note_count_measure.py --report data/results/note-count/rows.csv
  # 요약을 팀 MLflow에도 기록
  uv run python scripts/note_count_measure.py --report data/results/note-count/rows.csv --mlflow-uri http://localhost:5000

- 모델은 한 번만 올리고 파일마다 분리 → 채보. 채보 설정의 채보 가능 검사(노트 수·박 추적 실패)는 꺼서, 박을 못 찾은
  파일도 노트 수가 남게 함. 분리한 드럼 트랙이 무음이면 노트 0개로 적음
- 분리한 드럼 트랙과 원곡의 음량(RMS, dB)도 적음. 분리 직후 음량 검사를 만들지 판단하는 자료
- 분리 전 음악 여부 검사 분류 모델을 올릴 수 있으면 두 확률과 검사 시간도 적음. 못 올리면 건너뜀
- 파일 하나가 끝날 때마다 rows.csv에 한 줄을 붙임. 다시 실행하면 이미 있는 파일은 건너뜀
- 다 끝나면 summary.md를 씀. 이 파일이 있으면 끝난 것
"""

from __future__ import annotations

import argparse
import csv
import inspect
import json
import math
import shutil
import sys
import time
from pathlib import Path

import numpy as np

AUDIO_SUFFIXES = {".wav", ".flac", ".mp3", ".opus", ".ogg", ".m4a"}
COLUMNS = [
    "set",
    "name",
    "durationSec",
    "nNotes",
    "notesPerMin",
    "notesByPad",
    "bpm",
    "bpmEstimated",
    "drumRmsDb",
    "mixRmsDb",
    "drumMinusMixDb",
    "separateMs",
    "transcribeMs",
    "musicProb",
    "speechProb",
    "checkMs",
    "error",
]
# 요약 표에서 "이 값 미만인 파일 수"를 세는 기준값 후보
THRESHOLDS = (10, 20, 30, 50, 80, 100)
ROWS_NAME = "rows.csv"
SUMMARY_NAME = "summary.md"


def log(message: str) -> None:
    print(f"[note-count] {time.strftime('%H:%M:%S')} {message}", flush=True)


def find_inputs(root: Path) -> list[tuple[str, Path]]:
    """입력 폴더 아래 `<집합>/<파일>`을 (집합 이름, 경로)로. 집합·파일 이름 순."""
    items = []
    for set_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for f in sorted(set_dir.iterdir()):
            if f.suffix.lower() in AUDIO_SUFFIXES:
                items.append((set_dir.name, f))
    return items


def read_rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def append_row(path: Path, row: dict) -> None:
    new = not path.is_file()
    with path.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        if new:
            writer.writeheader()
        writer.writerow({k: row.get(k, "") for k in COLUMNS})


def rms_db(audio: np.ndarray) -> float:
    """(채널, 샘플) 배열의 RMS를 dB로. 무음이면 -120."""
    value = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)))) if audio.size else 0.0
    return round(20.0 * math.log10(value), 2) if value > 1e-6 else -120.0


def _num(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def summarize(rows: list[dict]) -> str:
    """집합별 1분당 노트 수 분포와 기준값 후보별 걸리는 파일 수를 마크다운으로."""
    sets: dict[str, list[dict]] = {}
    for r in rows:
        sets.setdefault(r["set"], []).append(r)
    lines = ["# 1분당 노트 수 측정 요약", "", f"파일 {len(rows)}개, 집합 {len(sets)}개", ""]
    lines += [
        "| 집합 | 파일 | 오류 | 최소 | 5% | 중앙 | 95% | 최대 | 박 추적 실패 | 드럼 트랙 - 원곡 음량 중앙(dB) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name, items in sets.items():
        npm = np.array([v for v in (_num(r["notesPerMin"]) for r in items) if v is not None])
        diff = [v for v in (_num(r["drumMinusMixDb"]) for r in items) if v is not None]
        errors = sum(1 for r in items if r["error"])
        no_beat = sum(1 for r in items if r["bpmEstimated"] == "False")
        if npm.size:
            q = [
                npm.min(),
                np.percentile(npm, 5),
                np.median(npm),
                np.percentile(npm, 95),
                npm.max(),
            ]
            stats = " | ".join(f"{v:.0f}" for v in q)
        else:
            stats = " | ".join(["-"] * 5)
        diff_text = f"{np.median(diff):.1f}" if diff else "-"
        lines.append(f"| {name} | {len(items)} | {errors} | {stats} | {no_beat} | {diff_text} |")
    lines += ["", "기준값 후보별로 1분당 노트 수가 그 값 미만인 파일 수", ""]
    lines.append("| 집합 | " + " | ".join(f"{t} 미만" for t in THRESHOLDS) + " |")
    lines.append("| --- |" + " --- |" * len(THRESHOLDS))
    for name, items in sets.items():
        npm = [v for v in (_num(r["notesPerMin"]) for r in items) if v is not None]
        cells = " | ".join(f"{sum(v < t for v in npm)}/{len(npm)}" for t in THRESHOLDS)
        lines.append(f"| {name} | {cells} |")
    checked = [r for r in rows if _num(r["checkMs"]) is not None]
    if checked:
        ms = np.array([float(r["checkMs"]) for r in checked])
        lines += [
            "",
            f"분리 전 음악 여부 검사 시간: 파일 {len(ms)}개, 중앙 {np.median(ms):.0f} ms, 최대 {ms.max():.0f} ms",
        ]
    failed = [r for r in rows if r["error"]]
    if failed:
        lines += ["", "오류가 난 파일", ""]
        lines += [f"- {r['set']}/{r['name']}: {r['error']}" for r in failed[:20]]
    return "\n".join(lines) + "\n"


def log_mlflow(rows: list[dict], uri: str, source: Path) -> None:
    """집합별 1분당 노트 수 요약을 MLflow 실험 `note-count-check`에 run 하나로 기록."""
    import mlflow

    mlflow.set_tracking_uri(uri)
    mlflow.set_experiment("note-count-check")
    with mlflow.start_run(run_name=source.parent.name):
        mlflow.log_param("nFiles", len(rows))
        sets: dict[str, list[float]] = {}
        for r in rows:
            v = _num(r["notesPerMin"])
            if v is not None:
                sets.setdefault(r["set"], []).append(v)
        for name, values in sets.items():
            arr = np.array(values)
            mlflow.log_metric(f"{name}/n", len(arr))
            mlflow.log_metric(f"{name}/notesPerMinMin", float(arr.min()))
            mlflow.log_metric(f"{name}/notesPerMinMedian", float(np.median(arr)))
            mlflow.log_metric(f"{name}/notesPerMinMax", float(arr.max()))
        mlflow.log_artifact(str(source))
    log(f"MLflow 기록: {uri} 실험 note-count-check")


def _load_music_check(config_path: str):
    """분리 전 음악 여부 검사 모듈을 올림. 못 올리면 None과 사유."""
    if not config_path:
        return None, "설정 경로를 비움"
    try:
        from ssaplash_ai.chart.config import MusicCheckConfig
        from ssaplash_ai.chart.music_check import MusicCheckModule
    except ImportError as e:
        return None, f"코드에 검사 모듈이 없음 ({e})"
    if not Path(config_path).is_file():
        return None, f"설정 파일이 없음 ({config_path})"
    try:
        module = MusicCheckModule(MusicCheckConfig.from_yaml(config_path))
        sec = module.load(force=True)
    except Exception as e:  # 측정용 선택 항목이라 어떤 실패든 건너뜀
        return None, f"분류 모델을 못 올림 ({type(e).__name__}: {str(e)[:120]})"
    log(f"음악 여부 검사 모델 올림 {sec:.1f}초")
    return module, ""


def measure(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.datasets.base import SAMPLE_RATE
    from ssaplash_ai.chart.audio_io import read_audio_file
    from ssaplash_ai.chart.config import SeparationConfig, TranscriptionConfig
    from ssaplash_ai.chart.errors import ChartError
    from ssaplash_ai.chart.separation import SeparationModule
    from ssaplash_ai.chart.transcription import TranscriptionModule

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    rows_path = out / ROWS_NAME
    items = find_inputs(Path(args.inputs).expanduser())
    if args.limit:
        items = items[: args.limit]
    if not items:
        log(f"입력 파일이 없음: {args.inputs}")
        return 1
    done = {(r["set"], r["name"]) for r in read_rows(rows_path)}
    todo = [(s, p) for s, p in items if (s, p.name) not in done]
    log(f"입력 {len(items)}개, 이미 끝난 것 {len(items) - len(todo)}개, 남은 것 {len(todo)}개")

    if todo:
        sep_config = SeparationConfig.from_yaml(args.separation_config)
        tr_config = TranscriptionConfig.from_yaml(args.transcription_config)
        # 채보 가능 검사를 끔. 노트가 적거나 박을 못 찾은 파일도 노트 수를 남기려는 것
        if hasattr(tr_config, "drum_check"):
            tr_config.drum_check.min_notes_per_minute = None
            tr_config.drum_check.fail_on_unknown_tempo = False
        separation = SeparationModule(sep_config, device=args.device)
        transcription = TranscriptionModule(tr_config, device=args.device)
        log(f"장치: 분리 {separation.device}, 채보 {transcription.device}")
        log(
            f"분리 모델 올림 {separation.load():.1f}초 ({separation.model_name} {separation.model_version})"
        )
        log(
            f"채보 모델 올림 {transcription.load():.1f}초 ({transcription.model_name} {transcription.model_version})"
        )
        music_check, reason = _load_music_check(args.music_check_config)
        if music_check is None:
            log(f"음악 여부 검사는 측정하지 않음: {reason}")
        with_beat_audio = (
            "beat_audio_path" in inspect.signature(transcription.transcribe_file).parameters
        )
        work = out / "work"
        for i, (set_name, path) in enumerate(todo, 1):
            row: dict = {"set": set_name, "name": path.name}
            job = work / f"{set_name}_{i}"
            try:
                if music_check is not None:
                    try:
                        mc = music_check.measure_file(path)
                        row.update(
                            musicProb=mc.music_prob, speechProb=mc.speech_prob, checkMs=mc.check_ms
                        )
                    except (
                        Exception
                    ) as e:  # 검사 시간 측정은 선택 항목. 실패해도 노트 수 측정은 계속
                        log(f"{set_name}/{path.name} 음악 여부 검사 실패: {type(e).__name__}")
                mix = read_audio_file(path, SAMPLE_RATE, sep_config.max_duration_sec)
                row["mixRmsDb"] = rms_db(mix)
                row["durationSec"] = round(mix.shape[1] / SAMPLE_RATE, 1)
                sep = separation.separate_file(path, job)
                row["separateMs"] = sep.separate_ms
                drums = read_audio_file_or_silence(sep.drum_stem_path, read_audio_file, SAMPLE_RATE)
                row["drumRmsDb"] = rms_db(drums)
                row["drumMinusMixDb"] = round(row["drumRmsDb"] - row["mixRmsDb"], 2)
                kwargs = {"beat_audio_path": path} if with_beat_audio else {}
                try:
                    tr = transcription.transcribe_file(sep.drum_stem_path, job, **kwargs)
                    n_notes, minutes = tr.n_notes, tr.duration_ms / 60000.0
                    row.update(
                        nNotes=n_notes,
                        notesPerMin=round(n_notes / minutes, 1) if minutes > 0 else "",
                        notesByPad=json.dumps(tr.notes_by_pad, ensure_ascii=False),
                        bpm=tr.bpm,
                        bpmEstimated=tr.bpm_estimated,
                        transcribeMs=tr.transcribe_ms,
                    )
                except ChartError as e:
                    if "무음" not in e.message:
                        raise
                    # 분리한 드럼 트랙이 무음. 서비스에서는 NOT_TRANSCRIBABLE로 끝나는 경우라 노트 0개로 적음
                    row.update(nNotes=0, notesPerMin=0.0, error="드럼 트랙 무음")
            except ChartError as e:
                row["error"] = f"{e.code}: {e.message}"[:200]
            except Exception as e:  # 파일 하나가 실패해도 나머지는 계속
                row["error"] = f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"[
                    :200
                ]
            finally:
                shutil.rmtree(job, ignore_errors=True)
            append_row(rows_path, row)
            log(
                f"{len(done) + i}/{len(items)} {set_name}/{path.name}: "
                f"노트 {row.get('nNotes', '-')}개, 1분당 {row.get('notesPerMin', '-')}"
                + (f", 오류 {row['error']}" if row.get("error") else "")
            )
        separation.close()
        transcription.close()
        if music_check is not None:
            music_check.close()
        shutil.rmtree(work, ignore_errors=True)

    summary = summarize(read_rows(rows_path))
    (out / SUMMARY_NAME).write_text(summary, encoding="utf-8")
    log(f"끝. 저장 {out / SUMMARY_NAME}")
    return 0


def read_audio_file_or_silence(path: Path, reader, sample_rate: int) -> np.ndarray:
    """드럼 트랙 읽기. 무음이라 읽기 함수가 입력 오류를 내면 길이 0 배열을 돌려줌(음량 -120dB로 적힘)."""
    try:
        return reader(path, sample_rate)
    except Exception:
        return np.zeros((2, 0), dtype=np.float32)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="파일마다 분리 → 채보를 돌려 1분당 노트 수를 측정")
    parser.add_argument("--inputs", help="입력 폴더. 집합 이름 폴더 아래 음원 파일")
    parser.add_argument("--out", help="결과 폴더. rows.csv·summary.md")
    parser.add_argument("--separation-config", default="configs/chart/separation.yaml")
    parser.add_argument("--transcription-config", default="configs/chart/transcription.yaml")
    parser.add_argument(
        "--music-check-config",
        default="configs/chart/music_check.yaml",
        help="분리 전 음악 여부 검사 설정. 빈 문자열이면 검사 시간을 측정하지 않음",
    )
    parser.add_argument("--device", help="cuda 또는 cpu. 없으면 설정값")
    parser.add_argument("--limit", type=int, help="앞에서 이 수만큼만 처리(동작 확인용)")
    parser.add_argument("--report", help="rows.csv 경로. 주면 측정 없이 요약만 출력")
    parser.add_argument(
        "--mlflow-uri", default="none", help="--report와 같이 주면 요약을 MLflow에 기록"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.report:
        rows = read_rows(Path(args.report))
        if not rows:
            print(f"행이 없음: {args.report}", file=sys.stderr)
            return 1
        print(summarize(rows))
        if args.mlflow_uri and args.mlflow_uri != "none":
            log_mlflow(rows, args.mlflow_uri, Path(args.report))
        return 0
    if not args.inputs or not args.out:
        print("--inputs와 --out이 필요 (요약만 볼 때는 --report)", file=sys.stderr)
        return 1
    return measure(args)


if __name__ == "__main__":
    sys.exit(main())
