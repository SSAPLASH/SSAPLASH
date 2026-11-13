"""결과 CSV 집계와 모델별 요약 표(마크다운). report 패키지의 데이터 쪽.

CSV만 읽고 모델·지표 코드는 모름.
모델 단위 값은 곡 값들의 중앙값 (MUSDB 관례). 실패한 곡(error 열)은 집계에서 뺌.
비교표 지표는 6개(드럼 SDR, 타격 보존율, attack slope 왜곡, 반주 SIR, RTF, 피크 GPU 메모리)
+ 가중치 라이선스. 나머지 열은 보조값 표에 둠.
정답 온셋 출처(MIDI·주석·검출기)가 데이터셋마다 달라 온셋 지표 뜻이 다르므로 데이터셋별 표도 따로 냄.
모델 순서는 드럼 SDR 중앙값 내림차순.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from pathlib import Path

import pandas as pd

# (CSV 열, 표 제목, 높을수록 좋은지)
COMPARISON_METRICS: tuple[tuple[str, str, bool], ...] = (
    ("sdrDrums", "드럼 SDR (dB)", True),
    ("onsetF1", "타격 보존율 F1 (±50ms)", True),
    ("attackSlopeDistortion", "attack slope 왜곡", False),
    ("sirAccomp", "반주 SIR (dB)", True),
    ("rtf", "RTF", False),
    ("peakVramMb", "피크 GPU 메모리 (MB)", False),
)
AUXILIARY_METRICS: tuple[tuple[str, str], ...] = (
    ("onsetF1Tight", "F1 (±25ms)"),
    ("onsetPrecision", "온셋 정밀도"),
    ("onsetRecall", "온셋 재현율"),
    ("siSdrDrums", "드럼 SI-SDR (dB)"),
    ("sdrAccomp", "반주 SDR (dB)"),
    ("sarAccomp", "반주 SAR (dB)"),
    ("sirDrums", "드럼 SIR (dB)"),
    ("sarDrums", "드럼 SAR (dB)"),
    ("mrFullness", "MR fullness"),
    ("mrBleedless", "MR bleedless"),
    ("mrFullnessHigh", "MR 고음 fullness"),
    ("mrLufsDiff", "MR 음량 차이 (LU)"),
    ("mrClipRatio", "MR 잘림 비율"),
    ("separateSec", "분리 시간 (s)"),
    ("loadSec", "로드 시간 (s)"),
    ("peakRamMb", "피크 RAM (MB)"),
)

SUMMARY_MD = "summary.md"
PER_SONG_CSV = "per_song.csv"
BARS_PNG = "metrics_by_model.png"
SCATTER_PNG = "rtf_vs_sdr.png"


def load_results(csv_paths: Sequence[Path | str]) -> pd.DataFrame:
    """결과 CSV 여러 개를 이어 붙임. 숫자 열은 float로 (inf·-inf 유지)."""
    frames = [pd.read_csv(p, encoding="utf-8") for p in csv_paths]
    df = pd.concat(frames, ignore_index=True)
    if "error" in df:
        df["error"] = df["error"].fillna("").astype(str)
    for col in [c for c, _, _ in COMPARISON_METRICS] + [c for c, _ in AUXILIARY_METRICS]:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _model_order(df: pd.DataFrame) -> list[str]:
    """드럼 SDR 중앙값 내림차순, 같으면 이름순. 실패한 곡은 뺌."""
    ok = df[df["error"] == ""] if "error" in df else df
    med = ok.groupby("model")["sdrDrums"].median() if "sdrDrums" in ok else pd.Series(dtype=float)

    def key(m: str) -> tuple[float, str]:
        v = float(med.get(m, math.nan))
        return (math.inf if math.isnan(v) else -v, m)

    return sorted(df["model"].unique(), key=key)


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    """모델별 한 행: 곡 수·실패 수·지표 중앙값·라이선스·파라미터 수."""
    ok = df[df["error"] == ""] if "error" in df else df
    metric_cols = [c for c, _, _ in COMPARISON_METRICS] + [c for c, _ in AUXILIARY_METRICS]
    metric_cols = [c for c in metric_cols if c in df]
    rows = []
    for model in _model_order(df):
        all_rows = df[df["model"] == model]
        good = ok[ok["model"] == model]
        row: dict[str, object] = {
            "model": model,
            "nSongs": int(len(all_rows)),
            "nErrors": int((all_rows["error"] != "").sum()) if "error" in all_rows else 0,
        }
        for col in metric_cols:
            row[col] = float(good[col].median()) if len(good) else math.nan
        for col in ("licenseWeights", "licenseCode", "checkpoint", "nParams", "device"):
            row[col] = all_rows[col].iloc[0] if col in all_rows else ""
        rows.append(row)
    return pd.DataFrame(rows)


def _fmt(value: object, digits: int = 2) -> str:
    if isinstance(value, float):
        if math.isnan(value):
            return "—"
        if math.isinf(value):
            return "−∞" if value < 0 else "+∞"
        return f"{value:.{digits}f}"
    if value is None or value == "":
        return "—"
    return str(value)


def _md_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines)


def summary_markdown(summary: pd.DataFrame, df: pd.DataFrame) -> str:
    """비교표 + 보조값 표 + 데이터셋별 표. 값은 곡 중앙값."""
    parts = ["# 드럼 분리 벤치마크 요약", ""]
    run_ids = sorted(df["runId"].astype(str).unique()) if "runId" in df else []
    datasets = sorted(df["dataset"].astype(str).unique()) if "dataset" in df else []
    parts.append(
        f"run: {', '.join(run_ids) or '—'} · 데이터셋: {', '.join(datasets) or '—'} · "
        f"행 {len(df)}개. 값은 실패한 곡을 뺀 곡별 값의 중앙값이고 표는 드럼 SDR 내림차순. "
        "RTF는 분리 시간 / 곡 길이(모델 로드 제외). attack slope 왜곡은 타격 직후 10ms 동안 소리가 커지는 기울기(attack slope)가 정답과 얼마나 다른지로, 0이 원음 그대로이고 클수록 타격 앞머리가 뭉개진 것."
    )
    parts.append("")
    parts.append("## 비교표")
    parts.append("")
    headers = ["모델", "곡/실패"] + [t for _, t, _ in COMPARISON_METRICS] + ["가중치 라이선스"]
    rows = []
    for _, r in summary.iterrows():
        cells = [str(r["model"]), f"{r['nSongs']}/{r['nErrors']}"]
        cells += [
            _fmt(r.get(c, math.nan), 3 if c in ("onsetF1", "rtf") else 2)
            for c, _, _ in COMPARISON_METRICS
        ]
        cells.append(_fmt(r.get("licenseWeights", "")))
        rows.append(cells)
    parts.append(_md_table(headers, rows))
    parts.append("")
    parts.append("## 보조값")
    parts.append("")
    headers = ["모델", "체크포인트", "파라미터 수", "장치"] + [t for _, t in AUXILIARY_METRICS]
    rows = []
    for _, r in summary.iterrows():
        n_params = r.get("nParams", "")
        n_params_str = (
            f"{int(n_params) / 1e6:.1f}M"
            if isinstance(n_params, int | float) and not math.isnan(float(n_params))
            else "—"
        )
        cells = [
            str(r["model"]),
            _fmt(r.get("checkpoint", "")),
            n_params_str,
            _fmt(r.get("device", "")),
        ]
        cells += [
            _fmt(r.get(c, math.nan), 3 if c.startswith("onset") else 4 if c == "mrClipRatio" else 2)
            for c, _ in AUXILIARY_METRICS
        ]
        rows.append(cells)
    parts.append(_md_table(headers, rows))
    if len(datasets) > 1:
        parts.append("")
        parts.append("## 데이터셋별")
        parts.append("")
        parts.append(
            "합성곡(synth)은 정답 온셋이 MIDI이고 MUSDB는 정답 스템 검출 온셋이라 온셋 지표를 섞어 읽지 않는다."
        )
        for ds in datasets:
            sub = summarize(df[df["dataset"].astype(str) == ds])
            parts.append("")
            parts.append(f"### {ds}")
            parts.append("")
            headers = ["모델", "곡/실패"] + [t for _, t, _ in COMPARISON_METRICS]
            rows = [
                [str(r["model"]), f"{r['nSongs']}/{r['nErrors']}"]
                + [
                    _fmt(r.get(c, math.nan), 3 if c in ("onsetF1", "rtf") else 2)
                    for c, _, _ in COMPARISON_METRICS
                ]
                for _, r in sub.iterrows()
            ]
            parts.append(_md_table(headers, rows))
    errors = df[df["error"] != ""] if "error" in df else df.iloc[0:0]
    if len(errors):
        parts.append("")
        parts.append("## 실패한 곡")
        parts.append("")
        rows = [
            [str(r["model"]), str(r["songId"]), str(r["error"])[:120]] for _, r in errors.iterrows()
        ]
        parts.append(_md_table(["모델", "곡", "오류"], rows))
    parts.append("")
    return "\n".join(parts)


def summary_metrics_by_model(summary: pd.DataFrame) -> dict[str, dict[str, float]]:
    """mlflow_tracking.log_run에 넘길 {모델: {열: 중앙값}}."""
    metric_cols = [c for c, _, _ in COMPARISON_METRICS] + [c for c, _ in AUXILIARY_METRICS]
    out: dict[str, dict[str, float]] = {}
    for _, r in summary.iterrows():
        out[str(r["model"])] = {c: float(r[c]) for c in metric_cols if c in summary}
        out[str(r["model"])]["nErrors"] = float(r["nErrors"])
    return out
