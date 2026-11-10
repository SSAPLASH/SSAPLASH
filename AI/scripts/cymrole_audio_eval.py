"""오디오 LLM 하이햇·라이드 마디 판정 채점 (11/09, 설계 CHART-003-audio-llm-cymbal, S15P31A307-325).

score: 답 파일(answers_<모델>_<오디오>.jsonl)마다 정확도·균형 정확도·AUC·고친 마디·망친 마디를 계산하고
  같은 마디의 지금 채보(current)·8패드 모델(bar_pad)·분리 트랙 에너지(bar_stem)와 나란히 csv로 씀.
  --gate면 통과 조합 목록을 json으로 씀(AUC GATE_AUC 이상, 비교 기준 AUC보다 GATE_MARGIN 이상 높음).
sections: 확신 기준을 PICK_SPLITS 마디로 고르고, 대상 split의 답을 judge_cymrole.py score가 읽는
  곡별 sections JSON으로 바꿈.
서버에서도 돌아야 해서 numpy만 씀(mlflow는 --mlflow일 때만 불러옴).

  python scripts/cymrole_audio_eval.py score --answers data/results/cymrole_audio/answers \
      --truth data/results/cymrole_audio/truth.jsonl --subset data/results/cymrole_audio/pilot.txt \
      --out data/results/cymrole_audio/pilot_scores.csv --gate data/results/cymrole_audio/gate.json
  python scripts/cymrole_audio_eval.py sections --answer data/results/cymrole_audio/answers/answers_qwen3omni_mix.jsonl \
      --truth data/results/cymrole_audio/truth.jsonl --split hold8 --out data/results/cymrole_audio/sections/qwen3omni_mix
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np

GATE_AUC = 0.80
GATE_MARGIN = 0.05
PICK_SPLITS = ("val10", "hold30")
BASELINES = ("current", "bar_pad", "bar_stem")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def auc(score: np.ndarray, pos: np.ndarray) -> float:
    """양성(pos=True)이 음성보다 점수가 높을 확률. 같은 점수는 0.5로 셈 (Mann-Whitney)."""
    p, n = score[pos], score[~pos]
    if not len(p) or not len(n):
        return float("nan")
    order = np.argsort(np.concatenate([p, n]), kind="mergesort")
    allv = np.concatenate([p, n])[order]
    ranks = np.empty(len(allv))
    i = 0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and allv[j + 1] == allv[i]:
            j += 1
        ranks[i : j + 1] = (i + j) / 2 + 1
        i = j + 1
    r = np.empty(len(allv))
    r[order] = ranks
    return float((r[: len(p)].sum() - len(p) * (len(p) + 1) / 2) / (len(p) * len(n)))


def baseline_answer(t: dict, name: str) -> tuple[str, float]:
    """비교 기준을 (판정, 라이드 쪽 점수)로. 점수가 없으면 0."""
    if name == "current":
        c = t["current"]
        return c, {"R": 1.0, "H": -1.0}.get(c, 0.0)
    v = t[name]
    v = 0.0 if v is None else float(v)
    return ("R" if v > 0 else "H" if v < 0 else "N"), v


def metrics(choice: list[str], score: list[float], truths: list[dict]) -> dict:
    """정답 H·R 마디에서 판정 지표. N 판정은 틀린 것으로 셈."""
    y = np.array([t["truth"] for t in truths])
    c = np.array(choice)
    cur_ok = np.array([t["current"] == t["truth"] for t in truths])
    ok = c == y
    acc_r = float(np.mean(ok[y == "R"])) if np.any(y == "R") else float("nan")
    acc_h = float(np.mean(ok[y == "H"])) if np.any(y == "H") else float("nan")
    return {
        "n": len(y),
        "acc": float(np.mean(ok)),
        "bal_acc": (acc_r + acc_h) / 2,
        "acc_R": acc_r,
        "acc_H": acc_h,
        "auc": auc(np.array(score, float), y == "R"),
        "n_current_wrong": int(np.sum(~cur_ok)),
        "fixed": int(np.sum(ok & ~cur_ok)),
        "broken": int(np.sum(~ok & cur_ok)),
        "answered_N": int(np.sum(c == "N")),
    }


def model_score(a: dict) -> float:
    p = a["p"]
    return float(p.get("R", 0.0)) - float(p.get("H", 0.0))


def cmd_score(args) -> int:
    truth = {t["case_id"]: t for t in read_jsonl(args.truth)}
    subset = None
    if args.subset is not None:
        subset = [
            x.strip() for x in args.subset.read_text(encoding="utf-8").splitlines() if x.strip()
        ]
    rows = []
    files = sorted(Path(args.answers).glob("answers_*.jsonl"))
    for f in files:
        ans = {a["case_id"]: a for a in read_jsonl(f)}
        ids = [c for c in (subset or ans) if c in ans and c in truth]
        if not ids:
            continue
        ts = [truth[c] for c in ids]
        m = metrics([ans[c]["choice"] for c in ids], [model_score(ans[c]) for c in ids], ts)
        name = f.stem.removeprefix("answers_")
        secs = [float(ans[c].get("sec", 0.0)) for c in ids]
        rows.append(
            {
                "name": name,
                **m,
                "sec_per_bar": float(np.mean(secs)),
                "missing": len(subset or ans) - len(ids),
            }
        )
        # 같은 마디의 비교 기준
        for b in BASELINES:
            pairs = [baseline_answer(t, b) for t in ts]
            mb = metrics([p[0] for p in pairs], [p[1] for p in pairs], ts)
            rows.append({"name": f"{name}|{b}", **mb, "sec_per_bar": 0.0, "missing": 0})
    if not rows:
        print("[eval] 채점할 답이 없음", flush=True)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        if "|" not in r["name"]:
            print(f"[eval] {r['name']}: n {r['n']} 균형 정확도 {r['bal_acc']:.3f} AUC {r['auc']:.3f} "
                  f"고친 {r['fixed']}/{r['n_current_wrong']} 망친 {r['broken']} N답 {r['answered_N']}", flush=True)  # fmt: skip
    if args.gate is not None:
        passed = gate(rows)
        args.gate.write_text(json.dumps(passed, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[eval] 통과 {len(passed)}개: {', '.join(passed) or '없음'}", flush=True)
    if args.mlflow:
        log_mlflow(rows, args)
    return 0


def gate(rows: list[dict]) -> list[str]:
    """AUC GATE_AUC 이상이고 같은 마디의 bar_pad·bar_stem AUC보다 GATE_MARGIN 이상 높은 답 이름."""
    by = {r["name"]: r for r in rows}
    out = []
    for r in rows:
        if "|" in r["name"] or not np.isfinite(r["auc"]):
            continue
        base = max(
            (
                by[f"{r['name']}|{b}"]["auc"]
                for b in ("bar_pad", "bar_stem")
                if np.isfinite(by[f"{r['name']}|{b}"]["auc"])
            ),
            default=0.5,
        )
        if r["auc"] >= GATE_AUC and r["auc"] >= base + GATE_MARGIN:
            out.append(r["name"])
    return out


def log_mlflow(rows: list[dict], args) -> None:
    import mlflow

    mlflow.set_experiment("chart-cymrole-audio")
    for r in rows:
        if "|" in r["name"]:
            continue
        model, _, audio = r["name"].rpartition("_")
        with mlflow.start_run(run_name=f"{r['name']}_{args.out.stem}"):
            mlflow.set_tags(
                {"jira": "S15P31A307-325", "model": model, "audio": audio, "subset": args.out.stem}
            )
            mlflow.log_metrics(
                {k: float(v) for k, v in r.items() if k != "name" and np.isfinite(float(v))}
            )
            for b in BASELINES:
                rb = next(x for x in rows if x["name"] == f"{r['name']}|{b}")
                mlflow.log_metrics({f"{b}_auc": rb["auc"], f"{b}_bal_acc": rb["bal_acc"]})
            mlflow.log_artifact(str(Path(args.answers) / f"answers_{r['name']}.jsonl"))
            mlflow.log_artifact(str(args.out))


def pick_threshold(ans: dict, truth: dict) -> float:
    """PICK_SPLITS 마디에서 '망친 마디 − 고친 마디'가 가장 작은 확신 기준. 같으면 높은 기준."""
    ids = [c for c, t in truth.items() if t["split"] in PICK_SPLITS and c in ans]
    best_t, best = 1.01, 0
    for th in np.round(np.arange(0.50, 1.0001, 0.02), 2):
        score = 0
        for c in ids:
            a, t = ans[c], truth[c]
            if a["choice"] not in ("H", "R") or max(a["p"].values()) < th:
                continue
            score += int(a["choice"] != t["truth"] and t["current"] == t["truth"])
            score -= int(a["choice"] == t["truth"] and t["current"] != t["truth"])
        if score < best or (score == best and th > best_t and best_t <= 1.0):
            best_t, best = float(th), score
    return best_t


def to_sections(ans: dict, truth: dict, split: str, th: float) -> dict[str, dict]:
    """대상 split의 확신 기준 이상 H·R 답을 곡별 sections JSON으로."""
    out: dict[str, dict] = {}
    for c, t in truth.items():
        if t["split"] != split or c not in ans:
            continue
        a = ans[c]
        conf = max(a["p"].values())
        if a["choice"] not in ("H", "R") or conf < th:
            continue
        out.setdefault(t["song"], {"sections": []})["sections"].append(
            {
                "from_bar": t["bar"],
                "to_bar": t["bar"],
                "timekeeping": a["choice"],
                "confidence": conf,
            }
        )
    return out


def cmd_sections(args) -> int:
    truth = {t["case_id"]: t for t in read_jsonl(args.truth)}
    ans = {a["case_id"]: a for a in read_jsonl(args.answer)}
    th = args.threshold if args.threshold is not None else pick_threshold(ans, truth)
    secs = to_sections(ans, truth, args.split, th)
    args.out.mkdir(parents=True, exist_ok=True)
    for song, body in secs.items():
        (args.out / f"{song}.json").write_text(
            json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    n = sum(len(b["sections"]) for b in secs.values())
    print(
        f"[eval] 확신 기준 {th:.2f}, {args.split} 곡 {len(secs)}개 마디 {n}개를 sections로 씀",
        flush=True,
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("score")
    s.add_argument("--answers", type=Path, required=True, help="answers_*.jsonl이 든 폴더")
    s.add_argument("--truth", type=Path, required=True)
    s.add_argument(
        "--subset", type=Path, default=None, help="채점할 case_id 목록 파일 (작은 시험 pilot.txt)"
    )
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--gate", type=Path, default=None)
    s.add_argument("--mlflow", action="store_true")
    c = sub.add_parser("sections")
    c.add_argument("--answer", type=Path, required=True)
    c.add_argument("--truth", type=Path, required=True)
    c.add_argument("--split", default="hold8")
    c.add_argument("--threshold", type=float, default=None, help="없으면 PICK_SPLITS로 고름")
    c.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    return cmd_score(args) if args.cmd == "score" else cmd_sections(args)


if __name__ == "__main__":
    raise SystemExit(main())
