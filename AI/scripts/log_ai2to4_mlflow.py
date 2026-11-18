"""AI 고도화(ai_2_to_4) 11/07 실험 결과를 MLflow에 기록. 여러 번 돌려도 됨(같은 실험의 이 스크립트 run은 지우고 다시 씀).

로컬 파일 모드 `mlruns/`(git 미추적)에 기록하고 `uv run mlflow ui --backend-store-uri mlruns`로 봄. 결과 파일만 읽으므로
있는 것만 기록하고, 아직 없는 결과(학습 중인 가중치 등)는 건너뜀.

실험
- ai2to4-tom-rule-retune: 탐 그룹 규칙 후보 92개. run 하나 = 후보 하나. E-GMD 26킷 평균 탐 이름 정확도, ENST 결과(채점한 후보만)
- ai2to4-cymbal-context: 크래시·라이드 문맥 후보 16개. E-GMD 26킷 평균, ENST(current·both_w080)
- ai2to4-tom-run-order: 이어 친 탐 순서 사전 측정(후보 2). 수치는 ROADMAP 11/07 기록
- ai2to4-finetune: 파인튜닝 가설 학습. run 하나 = 학습 하나. 에폭별 검증 지표, ENST 결과

  uv run python scripts/log_ai2to4_mlflow.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import yaml

TRACK = "mlruns"
SOURCE = "log_ai2to4_mlflow"
TOM = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
PADS8 = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
RETUNE = Path("docs/chart-rules/tom-rule-retune-2026-11")
CYM = Path("docs/chart-rules/cymbal-context-2026-11")
FT_DOCS = Path("docs/chart-rules/finetune-sep-2026-11")
RES = Path("data/results")
MODELS = Path("data/models/adtof_ft")
# 학습 → (best.pth, last.pth)를 채점 csv에서 부른 이름. h_sep의 best는 기본 가중치에 문턱값만 맞춘 것
ALIASES = {
    "h_clean": ("h_clean_best", "h_clean_last"),
    "h_sep": ("h_sep_best", "h_sep_last"),
    "h_h1_render": ("h1_best", "h1_last"),
    "h_h2_render_shift": ("h2_best", "h2_last"),
    "h_h4_overlay": ("h4_best", "h4_last"),
    "h_h5_pads": ("h5_best", "h5_last"),
}
FT_RUNS = {
    "h_clean": ("train_tom5_clean", "원래 E-GMD 드럼 780곡 (비교 기준)"),
    "h_sep": ("train_tom5_sep", "가설 3: MUSDB 반주를 섞어 BS Roformer SW로 다시 뽑은 드럼"),
    "h_h1_render": ("train_tom5_h1_render", "가설 1: 원래 + StemGMD 실제 키트 10종 렌더링"),
    "h_h2_render_shift": (
        "train_tom5_h2_render_shift",
        "가설 2: 원래 + 렌더링에서 킥 0~+12반음·탐 −5~+2반음",
    ),
    "h_h4_overlay": ("train_tom5_h4_overlay", "가설 4: 같은 키트 두 곡을 겹쳐 동시 타격을 늘림"),
    "h_h5_pads": ("train_pads_h5_clean", "가설 5: 탐 3종을 모델이 직접 내는 9패드 출력"),
}


def f1(tp: float, fp: float, fn: float) -> float:
    d = 2 * tp + fp + fn
    return 2 * tp / d if d else float("nan")


def counts_f1(df: pd.DataFrame, pads) -> float:
    return f1(*(sum(df[f"{k}{p}"].sum() for p in pads) for k in ("tp", "fp", "fn")))


def enst_metrics(df: pd.DataFrame, prefix: str) -> dict[str, float]:
    """곡별 csv(한 후보) → 드러머 그룹별 탐 3종·8패드·크래시·라이드 F1, 탐 이름 정확도"""
    out = {}
    groups = {
        "all": df,
        "d1": df[df.songId.str.startswith("drummer_1/")],
        "d23": df[~df.songId.str.startswith("drummer_1/")],
    }
    for g, d in groups.items():
        out[f"{prefix}_{g}_tom3_f1"] = counts_f1(d, TOM)
        out[f"{prefix}_{g}_pads8_f1"] = counts_f1(d, PADS8)
        for p in ("KICK", "CRASH", "RIDE"):
            out[f"{prefix}_{g}_{p.lower()}_f1"] = counts_f1(d, (p,))
        if "tomMatched" in d and d.tomMatched.sum():
            out[f"{prefix}_{g}_tom_name_acc"] = d.tomCorrect.sum() / d.tomMatched.sum()
        if "tomFalseKept" in d:
            out[f"{prefix}_{g}_tom_false_kept"] = float(d.tomFalseKept.sum())
    return out


def clean(metrics: dict[str, float]) -> dict[str, float]:
    return {k: float(v) for k, v in metrics.items() if v is not None and math.isfinite(float(v))}


def reset(mlflow, name: str) -> None:
    exp = mlflow.get_experiment_by_name(name)
    if exp is None:
        mlflow.create_experiment(name)
        return
    for r in mlflow.search_runs(
        [exp.experiment_id], filter_string=f"tags.source = '{SOURCE}'", output_format="list"
    ):
        mlflow.delete_run(r.info.run_id)


def log(
    mlflow, exp: str, name: str, params: dict, metrics: dict, artifacts=(), steps=(), tags=None
) -> None:
    mlflow.set_experiment(exp)
    with mlflow.start_run(run_name=name):
        mlflow.set_tags({"source": SOURCE, **(tags or {})})
        mlflow.log_params({k: str(v)[:500] for k, v in params.items()})
        mlflow.log_metrics(clean(metrics))
        for step, m in steps:
            mlflow.log_metrics(clean(m), step=step)
        for a in artifacts:
            if Path(a).is_file():
                mlflow.log_artifact(str(a))


def tom_rule_retune(mlflow) -> int:
    exp = "ai2to4-tom-rule-retune"
    egmd = RES / "tom-rule-retune/stream_egmd_test.csv"
    if not egmd.is_file():
        return 0
    reset(mlflow, exp)
    d = pd.read_csv(egmd)
    cands = {
        c["name"]: c["rules"]
        for c in yaml.safe_load((RETUNE / "candidates_part1.yaml").read_text(encoding="utf-8"))[
            "candidates"
        ]
    }
    pick = json.loads((RETUNE / "pick.json").read_text(encoding="utf-8"))
    enst = {k: pd.read_csv(RES / f"tom-rule-retune/stream_enst_{k}.csv") for k in ("drums", "sep")}
    keys = (
        "tom_relative_naming",
        "tom_relative_min_gap",
        "tom_relative_smooth",
        "tom_relative_min_frac",
        "tom_f0_method",
    )
    n = 0
    for name, g in d.groupby("candidate"):
        kit = g.groupby("kit")[["tomCorrect", "tomMatched"]].sum()
        m = {
            "egmd_kit_mean_tom_name_acc": float((kit.tomCorrect / kit.tomMatched).mean()),
            "egmd_tom_name_acc": g.tomCorrect.sum() / g.tomMatched.sum(),
            "egmd_tom3_f1": counts_f1(g, TOM),
        }
        for k, e in enst.items():
            sub = e[e.candidate == name]
            if len(sub):
                m.update(enst_metrics(sub, f"enst_{k}"))
        params = {k: cands[name].get(k, "기본값") for k in keys}
        arts = (
            [RETUNE / "summary.md", RETUNE / "enst.md", RETUNE / "pick.json"]
            if name == pick["chosen"]
            else []
        )
        log(
            mlflow,
            exp,
            name,
            params,
            m,
            arts,
            tags={"chosen": str(name == pick["chosen"]), "adopted": "False"},
        )
        n += 1
    return n


def cymbal_context(mlflow) -> int:
    exp = "ai2to4-cymbal-context"
    egmd = RES / "cymbal-context/egmd.csv"
    if not egmd.is_file():
        return 0
    reset(mlflow, exp)
    d = pd.read_csv(egmd)
    enst = {k: pd.read_csv(RES / f"cymbal-context/enst_{k}.csv") for k in ("drums", "sep")}
    n = 0
    for name, g in d.groupby("variant"):
        per_kit = g.groupby("kit").apply(
            lambda x: (counts_f1(x, ("CRASH",)) + counts_f1(x, ("RIDE",))) / 2
        )
        m = {
            "egmd_kit_mean_crash_ride": float(per_kit.mean()),
            "egmd_crash_f1": counts_f1(g, ("CRASH",)),
            "egmd_ride_f1": counts_f1(g, ("RIDE",)),
            "egmd_pads8_f1": counts_f1(g, PADS8),
        }
        for k, e in enst.items():
            sub = e[e.variant == name]
            if len(sub):
                m.update(enst_metrics(sub, f"enst_{k}"))
        mode = name.split("_")[0]
        log(
            mlflow,
            exp,
            name,
            {"mode": mode, "value": name.split("_")[-1] if "_" in name else "-"},
            m,
            [CYM / "summary.md"] if name == "both_w080" else [],
            tags={"chosen": str(name == "both_w080"), "adopted": "False"},
        )
        n += 1
    return n


def run_order(mlflow) -> int:
    exp = "ai2to4-tom-run-order"
    reset(mlflow, exp)
    # ROADMAP 11/07 기록값 (E-GMD test 1,170개, 지금 서비스 규칙, 이웃 탐 간격 0.3초 이하)
    m = {
        "pairs": 21376,
        "pairs_same_tom": 16598,
        "pairs_diff_tom": 4778,
        "pairs_diff_tom_same_group": 1753,
        "st_median_same_tom": 0.63,
        "st_p90_same_tom": 2.12,
        "st_median_diff_same_group": 1.25,
        "split_1st_hit_diff_same_group": 0.594,
        "split_1st_false_same_tom": 0.333,
        "split_2st_hit_diff_same_group": 0.226,
        "split_2st_false_same_tom": 0.109,
    }
    log(
        mlflow,
        exp,
        "egmd_test_pre_measure",
        {"dataset": "egmd_test_acoustic", "gap_sec": 0.3},
        m,
        tags={"adopted": "False", "values_from": "ai_2_to_4_ROADMAP.md 11/07"},
    )
    return 1


def bar_repeat(mlflow) -> int:
    exp = "ai2to4-bar-repeat"
    reset(mlflow, exp)
    # ROADMAP 11/07 기록값 (E-GMD test 1,170개, 서비스 규칙 예측, 마디 = bpm 4박, ±30ms)
    m = {
        "truth_on_16th_grid": 0.651,
        "tp": 377480,
        "tp_with_bar_neighbor": 0.757,
        "fp": 87566,
        "fp_with_bar_neighbor": 0.591,
        "fn": 311331,
        "fn_with_bar_neighbor": 0.165,
    }
    log(
        mlflow,
        exp,
        "egmd_test_pre_measure",
        {"dataset": "egmd_test_acoustic", "window_sec": 0.03},
        m,
        tags={"adopted": "False", "values_from": "ai_2_to_4_ROADMAP.md 11/07"},
    )
    return 1


def finetune(mlflow) -> int:
    exp = "ai2to4-finetune"
    reset(mlflow, exp)
    # ENST 채점 결과는 c1·c4 RIDE 기준으로 다시 돌린 r2~r5 파일 (가중치 이름_best·_last)
    enst = {}
    for k in ("drums", "sep"):
        files = sorted((RES / "finetune").glob(f"r[0-9]_{k}.csv"))
        if files:
            enst[k] = pd.concat([pd.read_csv(f) for f in files]).drop_duplicates(
                ["candidate", "songId"]
            )
    egmd = RES / "finetune/egmd_ckpts.csv"
    egmd_df = pd.read_csv(egmd) if egmd.is_file() else None
    mdb = RES / "finetune/mdb_thr.csv"
    mdb_df = pd.read_csv(mdb) if mdb.is_file() else None
    n = 0
    base = {}
    for k, e in enst.items():
        sub = e[e.candidate == "current"]
        if len(sub):
            base.update(enst_metrics(sub, f"enst_{k}"))
    if base:
        log(
            mlflow,
            exp,
            "current_base_weights",
            {"weights": "ADTOF 기본 가중치 (서비스)"},
            base,
            tags={"role": "baseline"},
        )
        n += 1
    for name, (cfg, note) in FT_RUNS.items():
        log_csv = MODELS / name / "log.csv"
        if not log_csv.is_file():
            continue
        cfg_path = FT_DOCS / f"{cfg}.yaml"
        c = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
        params = {
            "note": note,
            "classes": c.get("classes"),
            "train_datasets": ";".join(f"{x['path']}:{x['weight']}" for x in c["train_datasets"]),
            "val": ";".join(x["path"] for x in c["val_datasets"]),
            "max_epochs": c.get("max_epochs"),
            "steps_per_epoch": c.get("steps_per_epoch"),
            "learning_rate": c.get("learning_rate"),
            "device": "local RTX 4070 Laptop",
        }
        lg = pd.read_csv(log_csv)
        steps = []
        for r in lg.itertuples():
            steps.append(
                (int(r.epoch), {"val_f1": r.val_f1, "val_tom_f1": r.val_tom_f1, "loss": r.loss})
            )
        best = lg.loc[lg.val_tom_f1.idxmax()]
        m = {
            "best_val_tom_f1": best.val_tom_f1,
            "best_epoch": float(best.epoch),
            "epochs_done": float(lg.epoch.max() + 1),
        }
        for which, alias in zip(("best", "last"), ALIASES.get(name, ()), strict=False):
            for k, e in enst.items():
                sub = e[e.candidate == alias]
                if len(sub):
                    m.update(enst_metrics(sub, f"{which}_enst_{k}"))
            for label, df in (("egmd_test", egmd_df), ("mdb", mdb_df)):
                if df is not None and (df.candidate == alias).any():
                    sub = df[df.candidate == alias]
                    m[f"{which}_{label}_pads8_f1"] = counts_f1(sub, PADS8)
                    m[f"{which}_{label}_tom3_f1"] = counts_f1(sub, TOM)
        done = (MODELS / name / "done").is_file()
        log(mlflow, exp, name, params, m, [log_csv, cfg_path], steps, tags={"finished": str(done)})
        n += 1
    return n


def combo(mlflow) -> int:
    """패드 묶음별로 E-GMD 점수가 가장 높은 가중치를 골라 합친 조합. 패드 점수는 패드끼리 따로라 곡별 개수를 합침"""
    exp = "ai2to4-pad-combo"
    egmd = RES / "finetune/egmd_ckpts.csv"
    if not egmd.is_file():
        return 0
    reset(mlflow, exp)
    groups = {
        "kick": ("KICK",),
        "snare": ("SNARE",),
        "hihat": ("HIHAT",),
        "tom": TOM,
        "cymbal": ("CRASH", "RIDE"),
    }
    e = pd.read_csv(egmd)
    choice = {
        g: max(e.candidate.unique(), key=lambda c, p=pads: counts_f1(e[e.candidate == c], p))
        for g, pads in groups.items()
    }
    m = {}
    for k in ("drums", "sep"):
        files = sorted((RES / "finetune").glob(f"r[0-9]_{k}.csv"))
        d = pd.concat([pd.read_csv(f) for f in files]).drop_duplicates(["candidate", "songId"])
        for gname, keep in (("all", lambda s: True), ("d1", lambda s: s.startswith("drummer_1/"))):
            sub = d[d.songId.map(keep)]
            for label, pick in (("base", {g: "current" for g in groups}), ("combo", choice)):
                c = [
                    sum(
                        sub[sub.candidate == pick[g]][f"{t}{p}"].sum()
                        for g in groups
                        for p in groups[g]
                    )
                    for t in ("tp", "fp", "fn")
                ]
                m[f"enst_{k}_{gname}_{label}_pads8_f1"] = f1(*c)
    log(
        mlflow,
        exp,
        "egmd_selected_combo",
        {f"{g}_from": c for g, c in choice.items()},
        m,
        tags={"adopted": "False"},
    )
    return 1


def main() -> int:
    import os

    import mlflow

    os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
    mlflow.set_tracking_uri(Path(TRACK).resolve().as_uri())
    for fn in (tom_rule_retune, cymbal_context, run_order, bar_repeat, finetune, combo):
        print(f"[mlflow] {fn.__name__}: run {fn(mlflow)}개", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
