"""공용 곡 31곡(Songsterr 탭을 원곡 박에 맞춘 채보)으로 음원 채보가 정답을 얼마나 맞히는지 측정 (11/08).

정답: `data/songsterr/<곡>/final/chart.json` (빠르기가 바뀌는 두 곡은 `final_tempomap/`). 탭 노트를 원곡 박에 맞추고
±25ms 안 분리 드럼 온셋에 붙인 것. 탭은 사람이 적은 것이라 실제 연주와 다른 노트가 있을 수 있음.
입력: 같은 폴더 `drums.flac` (서비스 분리 모델로 원곡에서 뽑은 드럼, 정답과 같은 시간축).

- features: 곡마다 ADTOF + 드럼 킷 분리 특징을 저장(이미 있으면 건너뜀). GPU
- score: 후보 json(postproc_eval.py 형식)마다 `adtof_drumsep.yaml` 규칙으로 예측해 곡별 8패드 tp/fp/fn csv. CPU
- report: 전체·패드별·곡별 F1, current 대비 차이와 곡을 다시 뽑은 95% 구간

  uv run python scripts/public_songs_eval.py features --songs data/songsterr --out data/rule_features/public_songs
  uv run python scripts/public_songs_eval.py score --songs data/songsterr --features data/rule_features/public_songs \
      --candidates docs/chart-rules/postproc-2026-11/candidates_stage2.json --out data/results/public_songs/score.csv
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import time
from pathlib import Path

import numpy as np

TEMPO_MAP_SONGS = {"franz_ferdinand_take_me_out", "mcr_welcome_to_the_black_parade"}
TRANSCRIBER = "configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml"
HERE = Path(__file__).resolve().parent


def _pp():
    spec = importlib.util.spec_from_file_location("postproc_eval", HERE / "postproc_eval.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def song_dirs(root: Path) -> dict[str, Path]:
    out = {}
    for d in sorted(p for p in Path(root).iterdir() if p.is_dir()):
        f = d / ("final_tempomap" if d.name in TEMPO_MAP_SONGS else "final")
        if (f / "chart.json").is_file() and (f / "drums.flac").is_file():
            out[d.name] = f
    return out


def truth_hits(chart_path: Path) -> np.ndarray:
    from ssaplash_ai.bench.datasets.pads import HITS_DTYPE

    notes = json.loads(chart_path.read_text(encoding="utf-8"))["charts"][0]["notes"]
    pad = {"HIHAT_PEDAL": "HIHAT"}
    return np.array(
        sorted((n["timeMs"] / 1000.0, pad.get(n["pad"], n["pad"]), 0) for n in notes),
        dtype=HITS_DTYPE,
    )


def cmd_features(args: argparse.Namespace) -> int:
    import soundfile as sf

    from ssaplash_ai.bench.analysis import rule_features as rf
    from ssaplash_ai.bench.transcribers import TranscriberConfig, create_transcriber
    from ssaplash_ai.bench.transcribers.transcriber_base import to_mono

    out = Path(args.out)
    todo = {k: v for k, v in song_dirs(args.songs).items() if not (out / f"{k}.npz").is_file()}
    print(f"[public] 남은 곡 {len(todo)}개", flush=True)
    if not todo:
        return 0
    tr = create_transcriber(TranscriberConfig.from_yaml(args.model), args.device)
    try:
        print(f"[public] 채보 로드 {tr.load():.1f}s", flush=True)
        for name, d in todo.items():
            t0 = time.perf_counter()
            audio, sr = sf.read(d / "drums.flac", dtype="float32", always_2d=True)
            drums = audio.T
            f = rf.features_from_adapter(tr, drums, sr)
            f.stems["input"] = to_mono(drums).astype(rf.STEM_DTYPE)
            rf.save_features(out / f"{name}.npz", f)
            print(f"[public] {name} ({time.perf_counter() - t0:.1f}s)", flush=True)
    finally:
        tr.close()
    return 0


def cmd_score(args: argparse.Namespace) -> int:
    import yaml

    from ssaplash_ai.bench.analysis.rule_eval import predict_hits
    from ssaplash_ai.bench.analysis.rule_features import load_features
    from ssaplash_ai.bench.metrics.hit_f1 import score_hits

    pp = _pp()
    cands = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    rules = yaml.safe_load(pp.SERVICE_RULES.read_text(encoding="utf-8"))["rules"]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    errs = []
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = None
        for name, d in song_dirs(args.songs).items():
            truth = truth_hits(d / "chart.json")
            f = load_features(Path(args.features) / f"{name}.npz")
            f.input_audio = f.stems.pop("input").astype(np.float16)
            act = np.asarray(f.activations, dtype=np.float32)
            peaks0 = {int(k): list(v) for k, v in f.peaks.items()}
            for cand in cands:
                f.peaks = {
                    k: np.asarray(v, dtype=np.float64)
                    for k, v in pp.repick(act, peaks0, cand).items()
                }
                pred = pp.relabel(predict_hits(f, pp.rules_for(rules, cand)), act, cand)
                s = score_hits(truth, pred, "pads")
                row = {"candidate": cand["name"], "songId": name}
                for p in pp.SCORED:
                    c = s.by_label.get(p)
                    row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (
                        (c.tp, c.fp, c.fn) if c else (0, 0, 0)
                    )
                five = score_hits(truth, pred, "five")
                row["f1Five"] = round(five.f1, 4)
                row["meanErrMs"] = round(s.mean_err_ms, 2)
                if w is None:
                    w = csv.DictWriter(fh, fieldnames=list(row), lineterminator="\n")
                    w.writeheader()
                w.writerow(row)
                if cand["name"] == "current":
                    errs.append(s.mean_err_ms)
            print(f"[public] {name}", flush=True)
    print(
        f"[public] 저장 {args.out}, 곡별 평균 시각 차이 중앙값 {np.nanmedian(errs):.1f}ms",
        flush=True,
    )
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    import pandas as pd

    pp = _pp()
    d = pd.read_csv(args.score)
    names = list(dict.fromkeys(d.candidate))
    lines = [
        "| 후보 | 8패드 F1 | 5종 F1 (곡 평균) | current 대비 (95% 구간) |",
        "| --- | --- | --- | --- |",
    ]
    bs = pp.bootstrap(d, [n for n in names if n != "current"])
    for n in names:
        g = d[d.candidate == n]
        diff = "" if n == "current" else "{:+.3f} ({:+.3f} ~ {:+.3f})".format(*bs[n])
        lines.append(f"| {n} | {pp.f1_of(g):.3f} | {g.f1Five.mean():.3f} | {diff} |")
    lines += ["", "패드별 F1 (정답 노트 수)", "", "| 후보 | " + " | ".join(pp.SCORED) + " |",
              "| --- | " + " | ".join("---" for _ in pp.SCORED) + " |"]  # fmt: skip
    cur = d[d.candidate == "current"]
    lines.append(
        "| 정답 노트 수 | "
        + " | ".join(str(int(cur[f"tp{p}"].sum() + cur[f"fn{p}"].sum())) for p in pp.SCORED)
        + " |"
    )
    for n in names:
        g = d[d.candidate == n]
        lines.append(f"| {n} | " + " | ".join(f"{pp.f1_of(g, (p,)):.3f}" for p in pp.SCORED) + " |")
    lines += [
        "",
        "곡별 8패드 F1",
        "",
        "| 곡 | " + " | ".join(names) + " |",
        "| --- | " + " | ".join("---" for _ in names) + " |",
    ]
    for song, g in d.groupby("songId"):
        lines.append(
            f"| {song} | "
            + " | ".join(f"{pp.f1_of(g[g.candidate == n]):.3f}" for n in names)
            + " |"
        )
    text = "\n".join(lines) + "\n"
    Path(args.out).write_text(text, encoding="utf-8", newline="\n")
    print(text)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="command", required=True)
    f = sub.add_parser("features")
    f.add_argument("--songs", required=True, type=Path)
    f.add_argument("--out", required=True)
    f.add_argument("--model", default=TRANSCRIBER)
    f.add_argument("--device", default="cuda")
    s = sub.add_parser("score")
    s.add_argument("--songs", required=True, type=Path)
    s.add_argument("--features", required=True)
    s.add_argument("--candidates", required=True)
    s.add_argument("--out", required=True)
    r = sub.add_parser("report")
    r.add_argument("--score", required=True)
    r.add_argument("--out", required=True)
    args = ap.parse_args()
    return {"features": cmd_features, "score": cmd_score, "report": cmd_report}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
