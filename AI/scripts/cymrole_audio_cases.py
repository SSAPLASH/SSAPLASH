"""오디오 LLM 하이햇·라이드 마디 판정 시험의 질문 만들기 (11/09, 설계 CHART-003-audio-llm-cymbal, S15P31A307-325).

곡마다 마디 범위·정답(H·R)·지금 채보 이름·비교 기준 점수를 계산하고, 마디 오디오를 16kHz 모노 wav로 자름.
모델에 가는 cases.jsonl과 채점용 truth.jsonl을 따로 씀. 작은 시험 마디 목록은 pilot.txt.
--pack이면 서버 업로드 zip(질문·정답·wav·서버 스크립트)을 만듦.

  uv run python scripts/cymrole_audio_cases.py --out data/results/cymrole_audio --pack data/upload/server/cymrole_audio.zip
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import random
import zipfile
from pathlib import Path

import numpy as np

SR_OUT = 16000
# 정답 마디 조건: 정답 하이햇·라이드 노트 합이 MIN_NOTES개 이상이고 한쪽이 MAJORITY 이상
MIN_NOTES = 4
MAJORITY = 0.75
# 박 추정이 어긋난 마디를 빼려고 마디 길이를 이 범위로 제한
MIN_SEC, MAX_SEC = 0.8, 6.0
PEAK = 0.89  # 마디 wav 최대 진폭, -1 dBFS
SPLITS = {
    "val10": ("data/results/judge/val10", "configs/bench/datasets/public_songs_new_val10.yaml"),
    "hold30": ("data/results/judge/hold30", "configs/bench/datasets/public_songs_holdout38.yaml"),
    "hold8": ("data/results/judge/hold8", "configs/bench/datasets/public_songs_holdout38.yaml"),
}
PILOT_SPLITS = ("val10", "hold30")
SERVER_SCRIPTS = ("cymrole_audio_llm.py", "cymrole_audio_eval.py", "cymrole_audio_pipeline.py")
CASE_FIELDS = ("case_id", "audio_mix", "audio_drums", "seconds")


def _mod(name: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def bar_truth(times_h: np.ndarray, times_r: np.ndarray, a: float, e: float) -> str | None:
    """마디 [a, e) 안 정답 하이햇·라이드 노트로 H·R. 조건에 안 맞으면 None."""
    nh = int(np.sum((times_h >= a) & (times_h < e)))
    nr = int(np.sum((times_r >= a) & (times_r < e)))
    tot = nh + nr
    if tot < MIN_NOTES:
        return None
    if nh / tot >= MAJORITY:
        return "H"
    if nr / tot >= MAJORITY:
        return "R"
    return None


def chart_label(pads: list[str]) -> str:
    """지금 채보 그 마디의 하이햇·라이드 중 많은 쪽. 없으면 N, 같으면 H."""
    nh, nr = pads.count("HIHAT"), pads.count("RIDE")
    if nh == nr == 0:
        return "N"
    return "R" if nr > nh else "H"


def clip(audio: np.ndarray, sr: int, a: float, e: float) -> np.ndarray:
    """모노 오디오에서 [a, e)를 잘라 16kHz로 바꾸고 최대 진폭을 PEAK로 맞춤."""
    import soxr

    seg = np.asarray(audio[max(0, int(a * sr)) : int(e * sr)], dtype=np.float32)
    seg = soxr.resample(seg, sr, SR_OUT) if sr != SR_OUT else seg
    peak = float(np.max(np.abs(seg))) if len(seg) else 0.0
    return (seg * (PEAK / peak)).astype(np.float32) if peak > 0 else seg.astype(np.float32)


def pick_pilot(truth_rows: list[dict], n_per: int, per_song: int, seed: int) -> list[str]:
    """PILOT_SPLITS에서 R·H 각 n_per개. 곡당 라벨마다 per_song개까지, 지금 채보가 틀린 마디를 먼저."""
    rng = random.Random(seed)
    picked: list[str] = []
    for lab in ("R", "H"):
        rows = [r for r in truth_rows if r["split"] in PILOT_SPLITS and r["truth"] == lab]
        rng.shuffle(rows)
        rows.sort(key=lambda r: r["current"] == r["truth"])  # 틀린 마디가 앞
        count: dict[str, int] = {}
        out = []
        for r in rows:
            if count.get(r["song"], 0) >= per_song:
                continue
            count[r["song"]] = count.get(r["song"], 0) + 1
            out.append(r["case_id"])
            if len(out) == n_per:
                break
        picked += out
    return picked


def build_song(sid: str, split: str, chart, ds, args, jc) -> tuple[list[dict], list[dict]]:
    import soundfile as sf

    from ssaplash_ai.bench.analysis.rule_features import feature_path, load_features
    from ssaplash_ai.bench.metrics.hit_f1 import _relabel

    js, jr = _mod("judge_song"), _mod("judge_recheck")
    bars, _, _, _, _ = jc.song_bars(sid, chart, args)
    z = np.load(args.beats / f"{sid}.npz")
    slot_t, slot_w, _, _ = js.song_grid(chart, z["beats"], z["downbeats"])
    ranges = jr.bar_ranges(slot_t, slot_w)
    truth = _relabel(ds.hits_of(sid)[0], "pads")
    th = np.asarray(truth["time_sec"][truth["pad"] == "HIHAT"], float)
    tr = np.asarray(truth["time_sec"][truth["pad"] == "RIDE"], float)

    feats = load_features(feature_path(Path(args.features), "public_songs", sid))
    if "input" in feats.stems:  # 채보 모델에 넣은 분리 드럼
        drums = feats.stems["input"].reshape(-1).astype(np.float32)
    else:
        drums = sum(
            v.reshape(-1).astype(np.float32) for k, v in feats.stems.items() if k != "input"
        )
    sr_d = feats.sample_rate
    mix, sr_m = sf.read(str(Path(args.songs_root) / sid / "audio" / "mix.wav"), dtype="float32")
    mix = mix.mean(axis=1) if mix.ndim == 2 else mix

    clips = args.out / "clips"
    cases, truths = [], []
    for b, (a, e) in sorted(ranges.items()):
        if not MIN_SEC <= e - a <= MAX_SEC:
            continue
        lab = bar_truth(th, tr, a, e)
        if lab is None:
            continue
        cid = f"{sid}_{b:03d}"
        for kind, audio, sr in (("mix", mix, sr_m), ("drums", drums, sr_d)):
            path = clips / f"{cid}_{kind}.wav"
            if not path.is_file():
                sf.write(str(path), clip(audio, sr, a, e), SR_OUT, subtype="PCM_16")
        v = bars.get(b, {"idx": [], "p_h": None, "p_r": None, "e_h": 0.0, "e_r": 0.0})
        tot = v["e_h"] + v["e_r"]
        cases.append({"case_id": cid, "audio_mix": f"clips/{cid}_mix.wav",
                      "audio_drums": f"clips/{cid}_drums.wav", "seconds": round(e - a, 3)})  # fmt: skip
        truths.append({
            "case_id": cid, "song": sid, "bar": b, "split": split, "truth": lab,
            "current": chart_label([str(chart["pad"][i]) for i in v["idx"]]),
            "bar_pad": (v["p_r"] - v["p_h"]) if v["idx"] else None,
            "bar_stem": ((v["e_r"] - v["e_h"]) / tot) if tot > 0 else None,
            "from_sec": round(a, 3), "to_sec": round(e, 3),
        })  # fmt: skip
    return cases, truths


def pack(out: Path, dest: Path, clips: bool = True) -> None:
    """서버 업로드 zip. 질문·정답·작은 시험 목록·wav와 서버 스크립트. clips=False면 wav 빼고(스크립트만 고칠 때)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).parent
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ("cases.jsonl", "truth.jsonl", "pilot.txt"):
            z.write(out / name, f"cymrole_audio/{name}")
        for p in sorted((out / "clips").glob("*.wav")) if clips else []:
            z.write(p, f"cymrole_audio/clips/{p.name}")
        for name in SERVER_SCRIPTS:
            if (here / name).is_file():
                z.write(here / name, f"cymrole_audio/scripts/{name}")
            else:
                print(f"[cases] 경고: {name} 없음, zip에 안 넣음", flush=True)
    print(f"[cases] zip {dest} {dest.stat().st_size / 1e6:.1f}MB", flush=True)


def main() -> int:
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--beats", type=Path, default=Path("data/results/repeat/beats/public_songs"))
    ap.add_argument("--features", default="data/rule_features")
    ap.add_argument("--songs-root", default="data/songsterr")
    ap.add_argument("--splits", nargs="+", default=list(SPLITS))
    ap.add_argument("--pilot-per-label", type=int, default=60)
    ap.add_argument("--pilot-per-song", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--pack", type=Path, default=None, help="서버 업로드 zip 경로")
    ap.add_argument("--pack-only", action="store_true", help="이미 만든 결과로 zip만 다시 만듦")
    ap.add_argument(
        "--no-clips", action="store_true", help="zip에 wav를 넣지 않음. 서버에 wav가 이미 있을 때"
    )
    args = ap.parse_args()
    if args.pack_only:
        pack(args.out, args.pack, clips=not args.no_clips)
        return 0

    jc = _mod("judge_cymrole")
    (args.out / "clips").mkdir(parents=True, exist_ok=True)
    cases, truths = [], []
    for split in args.splits:
        cases_dir, yaml = SPLITS[split]
        ds = load_dataset(DatasetConfig.from_yaml(yaml))
        charts = dict(np.load(Path(cases_dir) / "private" / "chart.npz"))
        for sid, chart in charts.items():
            c, t = build_song(sid, split, chart, ds, args, jc)
            cases += c
            truths += t
            wrong = sum(r["current"] != r["truth"] for r in t)
            nr = sum(r["truth"] == "R" for r in t)
            print(
                f"[cases] {split} {sid} 마디 {len(t)} (R {nr}, H {len(t) - nr}, 지금 채보 틀림 {wrong})",
                flush=True,
            )

    for path, rows in ((args.out / "cases.jsonl", cases), (args.out / "truth.jsonl", truths)):
        path.write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8"
        )
    pilot = pick_pilot(truths, args.pilot_per_label, args.pilot_per_song, args.seed)
    (args.out / "pilot.txt").write_text("\n".join(pilot) + "\n", encoding="utf-8")

    for split in args.splits:
        t = [r for r in truths if r["split"] == split]
        nr = sum(r["truth"] == "R" for r in t)
        wrong = sum(r["current"] != r["truth"] for r in t)
        print(
            f"[cases] 합계 {split}: 마디 {len(t)}, R {nr}, H {len(t) - nr}, 지금 채보 틀림 {wrong}",
            flush=True,
        )
    by = {r["case_id"]: r for r in truths}
    pr = [by[c] for c in pilot]
    print(
        f"[cases] 작은 시험 {len(pr)}마디: R {sum(r['truth'] == 'R' for r in pr)}, "
        f"지금 채보 틀림 {sum(r['current'] != r['truth'] for r in pr)}, 곡 {len({r['song'] for r in pr})}",
        flush=True,
    )
    if args.pack is not None:
        pack(args.out, args.pack)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
