"""채보 결과 CSV 집계와 요약 표(마크다운).

CSV만 읽고 모델·지표 코드는 모름. 집계 단위는 (데이터 묶음, 모델, 입력, 분리 모델)이고
F1은 곡별 F1의 평균이 아니라 곡별 tp·fp·fn을 묶음 안에서 더한 값으로 다시 계산한다.
실패한 곡(error 열)은 집계에서 뺀다. RTF·GPU 메모리처럼 개수가 아닌 값은 곡 중앙값.
"분리 후 F1 변화"는 같은 (묶음, 모델)의 drums 행 대비 separated·mixture 행의 주 F1(8패드가 있으면
8패드, 없으면 5가지) 차이. drums 행이 없으면 빈칸.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from pathlib import Path

import pandas as pd

from ssaplash_ai.bench.metrics.hit_f1 import f1_from_counts

HITS_CSV = "hits_by_class.csv"
GROUP_KEY = ["dataset", "model", "input", "separator"]

# (요약 열, 표 제목, 높을수록 좋은지)
COMPARISON_METRICS: tuple[tuple[str, str, bool], ...] = (
    ("f1Five50", "5가지 F1", True),
    ("f1Pads50", "8패드 F1", True),
    ("deltaF1VsDrums", "분리 후 F1 변화", True),
    ("perfectRatio", "Perfect 폭 적중률", True),
    ("rtf", "RTF", False),
    ("peakVramMb", "피크 GPU 메모리 (MB)", False),
)
AUXILIARY_METRICS: tuple[tuple[str, str], ...] = (
    ("precFive50", "5가지 정밀도"),
    ("recFive50", "5가지 재현율"),
    ("f1Five25", "5가지 F1 (±25ms)"),
    ("precPads50", "8패드 정밀도"),
    ("recPads50", "8패드 재현율"),
    ("f1Pads25", "8패드 F1 (±25ms)"),
    ("f1Any50", "라벨 무시 F1"),
    ("meanErrMs", "시각 오차 평균 (ms)"),
    ("meanAbsErrMs", "시각 오차 절댓값 평균 (ms)"),
    ("velocityCorr", "세기 상관"),
    ("transcribeSec", "채보 시간 (s)"),
    ("loadSec", "로드 시간 (s)"),
    ("peakRamMb", "피크 RAM (MB)"),
    ("hitsPredDropped", "패드 밖 예측 수"),
)
MEDIAN_COLUMNS = (
    "rtf",
    "peakVramMb",
    "transcribeSec",
    "loadSec",
    "peakRamMb",
    "f1Any50",
    "meanErrMs",
    "meanAbsErrMs",
    "velocityCorr",
)
NUMERIC_COLUMNS = (
    "tpFive50",
    "fpFive50",
    "fnFive50",
    "tpFive25",
    "fpFive25",
    "fnFive25",
    "tpPads50",
    "fpPads50",
    "fnPads50",
    "tpPads25",
    "fpPads25",
    "fnPads25",
    "hitsTrue",
    "hitsPred",
    "hitsPredDropped",
    "durationSec",
    "separateSec",
    *MEDIAN_COLUMNS,
)


def _as_bool(series: pd.Series) -> pd.Series:
    return series.astype(str).str.lower().isin(("true", "1"))


def load_results(csv_paths: Sequence[Path | str]) -> pd.DataFrame:
    """results.csv 여러 개를 이어 붙임. 숫자 열은 float로, eightPad·hasVelocity는 bool로."""
    frames = [pd.read_csv(p, encoding="utf-8", dtype=str, keep_default_na=False) for p in csv_paths]
    df = pd.concat(frames, ignore_index=True)
    for col in NUMERIC_COLUMNS:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ("eightPad", "hasVelocity"):
        if col in df:
            df[col] = _as_bool(df[col])
    if "separator" not in df:
        df["separator"] = ""
    df["separator"] = df["separator"].fillna("").astype(str)
    df["error"] = df["error"].fillna("").astype(str) if "error" in df else ""
    return df


def load_hits_by_class(csv_paths: Sequence[Path | str]) -> pd.DataFrame:
    """results.csv와 같은 폴더의 hits_by_class.csv를 전부 이어 붙임. 없으면 빈 표."""
    frames = []
    for p in csv_paths:
        path = Path(p).parent / HITS_CSV
        if path.is_file():
            frames.append(pd.read_csv(path, encoding="utf-8", dtype=str, keep_default_na=False))
    if not frames:
        return pd.DataFrame(
            columns=["runId", "model", "input", "separator", "dataset", "songId", "scheme", "label"]
            + ["windowMs", "tp", "fp", "fn"]
        )
    df = pd.concat(frames, ignore_index=True)
    for col in ("windowMs", "tp", "fp", "fn"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _group_label(row: pd.Series) -> str:
    """표에 쓰는 입력 설명. drums / mixture / separated(분리 모델)."""
    inp = str(row["input"])
    sep = str(row.get("separator", "") or "")
    return f"{inp}({sep})" if inp == "separated" and sep else inp


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    """(묶음, 모델, 입력, 분리 모델)당 한 행. 개수 합산 F1 + 중앙값 보조값 + 분리 후 변화."""
    ok = df[df["error"] == ""]
    rows: list[dict] = []
    for key, all_rows in df.groupby(GROUP_KEY, sort=False, dropna=False):
        good = ok[(ok[GROUP_KEY] == pd.Series(key, index=GROUP_KEY)).all(axis=1)]
        dataset, model, inp, sep = key
        eight = bool(good["eightPad"].iloc[0]) if len(good) and "eightPad" in good else False
        row: dict[str, object] = {
            "dataset": dataset,
            "model": model,
            "input": inp,
            "separator": sep,
            "inputLabel": _group_label(pd.Series({"input": inp, "separator": sep})),
            "nSongs": int(len(all_rows)),
            "nErrors": int((all_rows["error"] != "").sum()),
            "eightPad": eight,
        }
        for prefix in ("Five", "Pads"):
            for window in ("50", "25"):
                tp = good[f"tp{prefix}{window}"].sum(min_count=1) if len(good) else math.nan
                fp = good[f"fp{prefix}{window}"].sum(min_count=1) if len(good) else math.nan
                fn = good[f"fn{prefix}{window}"].sum(min_count=1) if len(good) else math.nan
                has = len(good) > 0 and not (math.isnan(tp) or math.isnan(fp) or math.isnan(fn))
                row[f"tp{prefix}{window}"] = tp
                row[f"fp{prefix}{window}"] = fp
                row[f"fn{prefix}{window}"] = fn
                row[f"f1{prefix}{window}"] = f1_from_counts(tp, fp, fn) if has else math.nan
                if window == "50" and has:
                    row[f"prec{prefix}50"] = tp / (tp + fp) if tp + fp else 0.0
                    row[f"rec{prefix}50"] = tp / (tp + fn) if tp + fn else 0.0
                elif window == "50":
                    row[f"prec{prefix}50"] = row[f"rec{prefix}50"] = math.nan
        main50 = row["f1Pads50"] if eight else row["f1Five50"]
        main25 = row["f1Pads25"] if eight else row["f1Five25"]
        row["f1Main50"] = main50
        row["perfectRatio"] = (
            main25 / main50 if isinstance(main50, float) and main50 > 0 else math.nan
        )
        for col in MEDIAN_COLUMNS:
            row[col] = float(good[col].median()) if len(good) and col in good else math.nan
        row["hitsPredDropped"] = (
            float(good["hitsPredDropped"].sum()) if len(good) and "hitsPredDropped" in good else 0.0
        )
        for col in ("licenseWeights", "licenseCode", "checkpoint", "nParams", "device", "gpuName"):
            row[col] = all_rows[col].iloc[0] if col in all_rows else ""
        rows.append(row)
    summary = pd.DataFrame(rows)
    if summary.empty:
        return summary
    # 분리 후 F1 변화: 같은 (묶음, 모델)의 drums 행 대비
    base = {
        (r["dataset"], r["model"]): r["f1Main50"]
        for _, r in summary.iterrows()
        if r["input"] == "drums"
    }
    summary["deltaF1VsDrums"] = [
        (r["f1Main50"] - base[(r["dataset"], r["model"])])
        if r["input"] != "drums" and (r["dataset"], r["model"]) in base
        else math.nan
        for _, r in summary.iterrows()
    ]
    return _ordered(summary)


def _ordered(summary: pd.DataFrame) -> pd.DataFrame:
    """묶음 이름순 → 주 F1 내림차순 → 모델·입력 이름순."""

    def key(r: pd.Series) -> tuple:
        v = r["f1Main50"]
        return (
            str(r["dataset"]),
            math.inf if pd.isna(v) else -float(v),
            str(r["model"]),
            str(r["inputLabel"]),
        )

    order = sorted(range(len(summary)), key=lambda i: key(summary.iloc[i]))
    return summary.iloc[order].reset_index(drop=True)


def label_f1_table(hits: pd.DataFrame, scheme: str, window_ms: int = 50) -> pd.DataFrame:
    """라벨별 묶음 F1 (개수 합산). 행 = (묶음, 모델, 입력, 분리 모델), 열 = 라벨."""
    if hits.empty:
        return pd.DataFrame()
    sub = hits[(hits["scheme"] == scheme) & (hits["windowMs"] == window_ms)]
    if sub.empty:
        return pd.DataFrame()
    agg = sub.groupby(GROUP_KEY + ["label"], sort=False)[["tp", "fp", "fn"]].sum().reset_index()
    agg["f1"] = [f1_from_counts(r.tp, r.fp, r.fn) for r in agg.itertuples()]
    table = agg.pivot_table(index=GROUP_KEY, columns="label", values="f1", aggfunc="first")
    return table.reset_index()


def label_f1_metrics(hits: pd.DataFrame, window_ms: int = 50) -> dict[str, dict[str, float]]:
    """mlflow_tracking.log_run용 {모델: {f1_{라벨}: 값}}. 패드 8종(pads 기준)과 tom·cymbal(five 기준).

    run 하나는 입력이 하나라 모델만 키로 씀. 규칙을 바꿔 가며 잰 run을 MLflow에서
    나란히 놓고 패드별 차이를 보기 위한 것.
    """
    out: dict[str, dict[str, float]] = {}
    for scheme, keep in (("pads", None), ("five", ("tom", "cymbal"))):
        table = label_f1_table(hits, scheme, window_ms)
        if table.empty:
            continue
        label_cols = [c for c in table.columns if c not in GROUP_KEY]
        for _, r in table.iterrows():
            values = out.setdefault(str(r["model"]), {})
            for c in label_cols:
                if keep is not None and c not in keep:
                    continue
                v = r[c]
                if isinstance(v, int | float) and pd.notna(v):
                    values[f"f1_{c}"] = float(v)
    return out


def _fmt(value: object, digits: int = 3) -> str:
    if isinstance(value, float):
        if math.isnan(value):
            return "—"
        return f"{value:+.{digits}f}" if digits < 0 else f"{value:.{digits}f}"
    if value is None or value == "":
        return "—"
    return str(value)


def _fmt_delta(value: object) -> str:
    if isinstance(value, float) and not math.isnan(value):
        return f"{value:+.3f}"
    return "—"


def _md_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines)


def _gpu_names(summary: pd.DataFrame) -> set[str]:
    """요약 행들의 GPU 이름 집합. 빈칸·nan은 뺌."""
    if "gpuName" not in summary:
        return set()
    return {str(g) for g in summary["gpuName"] if not pd.isna(g) and str(g) != ""}


def _metric_cell(r: pd.Series, col: str) -> str:
    v = r.get(col, math.nan)
    if col == "deltaF1VsDrums":
        return _fmt_delta(v)
    if col == "peakVramMb":
        return _fmt(v, 0)
    if col == "rtf":
        return _fmt(v, 3)
    return _fmt(v, 3)


def summary_markdown(summary: pd.DataFrame, df: pd.DataFrame, hits: pd.DataFrame) -> str:
    """묶음별 비교표 + 보조값 + 라벨별 F1 + 실패 목록."""
    parts = ["# 드럼 채보 벤치마크 요약", ""]
    run_ids = sorted(df["runId"].astype(str).unique()) if "runId" in df else []
    parts.append(
        f"run: {', '.join(run_ids) or '—'} · 행 {len(df)}개. "
        "F1은 묶음 안 모든 곡의 맞힌·헛것·놓친 개수를 더해 계산한 값(곡별 평균 아님)이고 오류가 난 곡은 집계에서 뺀다. "
        "8패드 F1은 8패드를 다 내는 모델만, Perfect 폭 적중률은 ±25ms F1 ÷ ±50ms F1(8패드가 있으면 8패드 기준). "
        "분리 후 F1 변화는 같은 모델의 정답 드럼(drums) 입력 대비 차이. RTF는 채보 시간 ÷ 곡 길이(로드·분리 제외, 곡 중앙값)."
    )
    parts.append("")
    datasets = list(dict.fromkeys(summary["dataset"].astype(str))) if len(summary) else []
    for ds in datasets:
        sub = summary[summary["dataset"].astype(str) == ds]
        parts.append(f"## {ds}")
        parts.append("")
        # 다른 GPU에서 잰 run이 섞이면 RTF·GPU 메모리를 바로 비교할 수 없어 GPU 열을 붙임
        mixed_gpu = len(_gpu_names(sub)) > 1
        headers = (
            ["모델", "입력", "곡/실패"]
            + [t for _, t, _ in COMPARISON_METRICS]
            + ["가중치 라이선스"]
            + (["GPU"] if mixed_gpu else [])
        )
        rows = []
        for _, r in sub.iterrows():
            cells = [str(r["model"]), str(r["inputLabel"]), f"{r['nSongs']}/{r['nErrors']}"]
            cells += [_metric_cell(r, c) for c, _, _ in COMPARISON_METRICS]
            cells.append(_fmt(r.get("licenseWeights", "")))
            if mixed_gpu:
                cells.append(_fmt(r.get("gpuName", "")))
            rows.append(cells)
        parts.append(_md_table(headers, rows))
        parts.append("")
        parts.append(f"### {ds} 보조값")
        parts.append("")
        headers = ["모델", "입력", "체크포인트", "파라미터 수"] + [t for _, t in AUXILIARY_METRICS]
        rows = []
        for _, r in sub.iterrows():
            n_params = r.get("nParams", "")
            try:
                n_params_str = f"{float(n_params) / 1e6:.1f}M" if str(n_params) != "" else "—"
            except ValueError:
                n_params_str = "—"
            cells = [
                str(r["model"]),
                str(r["inputLabel"]),
                _fmt(r.get("checkpoint", "")),
                n_params_str,
            ]
            cells += [
                _fmt(r.get(c, math.nan), 0 if c in ("peakRamMb", "hitsPredDropped") else 3)
                for c, _ in AUXILIARY_METRICS
            ]
            rows.append(cells)
        parts.append(_md_table(headers, rows))
        for scheme, title in (("pads", "패드별 F1 (±50ms)"), ("five", "5가지별 F1 (±50ms)")):
            table = (
                label_f1_table(hits[hits["dataset"].astype(str) == ds], scheme)
                if len(hits)
                else pd.DataFrame()
            )
            if table.empty:
                continue
            labels = [c for c in table.columns if c not in GROUP_KEY]
            parts.append("")
            parts.append(f"### {ds} {title}")
            parts.append("")
            rows = [
                [str(r["model"]), _group_label(r)] + [_fmt(float(r[c]), 3) for c in labels]
                for _, r in table.iterrows()
            ]
            parts.append(_md_table(["모델", "입력", *labels], rows))
        parts.append("")
    errors = df[df["error"] != ""]
    if len(errors):
        parts.append("## 실패한 곡")
        parts.append("")
        rows = [
            [
                str(r["model"]),
                str(r["input"]),
                str(r["dataset"]),
                str(r["songId"]),
                str(r["error"])[:120],
            ]
            for _, r in errors.iterrows()
        ]
        parts.append(_md_table(["모델", "입력", "묶음", "곡", "오류"], rows))
        parts.append("")
    return "\n".join(parts)


def summary_metrics_by_model(summary: pd.DataFrame) -> dict[str, dict[str, float]]:
    """mlflow_tracking.log_run에 넘길 {모델: {열: 값}}. run 하나는 묶음·입력이 하나라 모델만 키로."""
    cols = [c for c, _, _ in COMPARISON_METRICS] + [c for c, _ in AUXILIARY_METRICS]
    out: dict[str, dict[str, float]] = {}
    for _, r in summary.iterrows():
        name = (
            str(r["model"])
            if len(summary["model"].unique()) == len(summary)
            else (f"{r['model']}@{r['inputLabel']}")
        )
        values = {c: float(r[c]) for c in cols if c in summary and isinstance(r[c], int | float)}
        values["nErrors"] = float(r["nErrors"])
        out[name] = values
    return out
