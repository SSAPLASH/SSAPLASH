"""STRUM CRNN 학습 스크립트가 쓰는 학습·검증·점수 저장 흐름 (11/11).

`strum_crnn.py`는 (1) 모델 읽기 (2) 파형 → 분류별 온셋 로짓 (3) 곡 하나 → 프레임별 점수 세 가지만 만들고
나머지(구간 뽑기, focal BCE, 검증 곡 8패드 F1, 가장 높은 가중치 저장, 끊긴 학습 이어 가기)는 여기 것을 씀.
별도 가상환경에서 `python -I`로 돌므로 numpy·scipy·torch만 씀.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from _common import (
    PADS,
    SegmentSet,
    acts_path,
    frame_targets,
    load_manifest,
    load_meta,
    read_mono,
    save_acts,
)

THRESHOLDS = (0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)


class TrainSet:
    """DataLoader용. 구간 파형과 프레임 정답 (프레임, 분류)을 냄."""

    def __init__(
        self,
        segments: SegmentSet,
        hop: int,
        fps: float,
        n_classes: int,
        pad_to_class: dict[int, int],
        radiation: int,
        floor: bool,
    ):
        self.segments, self.hop, self.fps = segments, hop, fps
        self.n_classes, self.pad_to_class = n_classes, pad_to_class
        self.radiation, self.floor = radiation, floor

    def __len__(self) -> int:
        return len(self.segments)

    def __getitem__(self, _):
        import torch

        audio, times, pads = self.segments.draw()
        n_frames = len(audio) // self.hop + 1
        target = frame_targets(
            times,
            pads,
            n_frames,
            self.fps,
            self.n_classes,
            self.pad_to_class,
            self.radiation,
            self.floor,
        )
        return torch.from_numpy(audio), torch.from_numpy(target)


def focal_bce(logits, targets, pos_weight, gamma: float = 2.0):
    """분류별 pos_weight를 준 focal BCE. logits·targets는 (배치, 프레임, 분류)."""
    import torch
    import torch.nn.functional as F

    logits, targets = logits.float(), targets.float()
    bce = F.binary_cross_entropy_with_logits(
        logits, targets, pos_weight=pos_weight, reduction="none"
    )
    probs = torch.sigmoid(logits)
    p_t = torch.where(targets > 0.5, probs, 1 - probs).clamp(min=1e-6, max=1 - 1e-6)
    return ((1 - p_t) ** gamma * bce).mean()


def match_counts(truth: np.ndarray, pred: np.ndarray, window: float = 0.05) -> tuple[int, int, int]:
    """정렬된 두 시각 배열을 ±window 안에서 앞에서부터 짝지은 tp·fp·fn."""
    i = j = tp = 0
    while i < len(truth) and j < len(pred):
        d = pred[j] - truth[i]
        if abs(d) <= window:
            tp, i, j = tp + 1, i + 1, j + 1
        elif d < 0:
            j += 1
        else:
            i += 1
    return tp, len(pred) - tp, len(truth) - tp


def evaluate(infer, songs: list[dict], names: list[str], fps: float) -> dict:
    """검증 곡 8패드 F1. infer(파형) → (프레임, 분류) 점수. 분류별 문턱값은 이 곡들에서 가장 높은 것(가중치 고르기 전용)."""
    from scipy.signal import find_peaks

    gap = max(1, int(round(0.03 * fps)))
    counts = np.zeros((len(names), len(THRESHOLDS), 3), dtype=np.int64)
    for song in songs:
        acts = infer(read_mono(song["drums"]))
        z = np.load(song["labels"])
        for c, cname in enumerate(names):
            truth = np.sort(z["time"][z["pad"] == PADS.index(cname)])
            peaks, props = find_peaks(acts[:, c], height=THRESHOLDS[0], distance=gap)
            for ti, th in enumerate(THRESHOLDS):
                pred = peaks[props["peak_heights"] >= th] / fps
                counts[c, ti] += match_counts(truth, pred)
    out, total = {}, np.zeros(3, dtype=np.int64)
    for c, cname in enumerate(names):
        f1 = 2 * counts[c, :, 0] / np.maximum(2 * counts[c, :, 0] + counts[c, :, 1:].sum(1), 1)
        best = int(np.argmax(f1))
        total += counts[c, best]
        out[cname] = {"f1": float(f1[best]), "thr": THRESHOLDS[best]}
    out["f1"] = float(2 * total[0] / max(2 * total[0] + total[1] + total[2], 1))
    return out


def dump(
    infer_all,
    manifests: list[str],
    acts_root: str,
    tag: str,
    names: list[str],
    fps: float,
    checkpoint: str,
) -> None:
    """곡 목록마다 프레임별 점수를 저장. infer_all(파형) → {종류: (프레임, 분류)}. 이미 있는 곡은 건너뜀."""
    import torch

    for manifest in manifests:
        meta = load_meta(manifest)
        done = 0
        for song in meta["songs"]:
            path = acts_path(Path(acts_root), tag, meta["name"], song["song_id"])
            if path.is_file():
                continue
            audio = read_mono(song["drums"])
            t0 = time.perf_counter()
            acts = infer_all(audio)
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            save_acts(path, fps, names, acts, time.perf_counter() - t0, checkpoint)
            done += 1
        print(f"[dump] {tag} {meta['name']} 새로 {done}곡", flush=True)


def add_common_args(sub, default_seconds: float, default_lr: float, default_batch: int) -> None:
    """dump·train 하위 명령에 공통 인자를 붙임."""
    d, t = sub.choices["dump"], sub.choices["train"]
    for p in (d, t):
        p.add_argument("--device", default="cuda")
    t.add_argument(
        "--mem-fraction",
        type=float,
        default=0.0,
        help="이 프로세스가 쓸 GPU 메모리 상한(전체 대비). 0이면 상한 없음. 로컬 8GB GPU는 0.85",
    )
    d.add_argument("--tag", required=True)
    d.add_argument("--manifest", action="append", required=True)
    d.add_argument("--checkpoint", default=None, help="이어서 학습한 가중치(best.pt)")
    d.add_argument("--acts", default="data/ext_train/acts")
    t.add_argument("--train", action="append", required=True, help="곡 목록[:가중치] (여러 번)")
    t.add_argument("--val", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--steps", type=int, default=6000)
    t.add_argument("--batch", type=int, default=default_batch)
    t.add_argument("--seconds", type=float, default=default_seconds)
    t.add_argument("--lr", type=float, default=default_lr)
    t.add_argument("--radiation", type=int, default=1)
    t.add_argument("--pos-scale", type=float, default=1.0)
    t.add_argument("--gamma", type=float, default=2.0)
    t.add_argument("--accomp-prob", type=float, default=0.3)
    t.add_argument("--workers", type=int, default=4)
    t.add_argument("--eval-every", type=int, default=500)
    t.add_argument("--log-every", type=int, default=50)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument(
        "--amp", action="store_true", help="모델 계산을 16비트로(메모리 절약). 손실은 32비트"
    )


def resolve_paths(args: argparse.Namespace) -> None:
    """경로를 절대 경로로 바꿈. 학습 목록 `경로:비율`은 (경로, 비율)로."""
    args.root = str(Path.cwd())
    for key in ("checkpoint", "acts", "val", "out", "init"):
        if getattr(args, key, None):
            setattr(args, key, str(Path(getattr(args, key)).resolve()))
    if getattr(args, "manifest", None):
        args.manifest = [str(Path(m).resolve()) for m in args.manifest]
    if getattr(args, "train", None):
        fixed = []
        for item in args.train:
            path, sep, weight = item.rpartition(":")
            if sep and weight.replace(".", "", 1).isdigit():
                fixed.append((str(Path(path).resolve()), float(weight)))
            else:
                fixed.append((str(Path(item).resolve()), 1.0))
        args.train = fixed


def train(
    args: argparse.Namespace,
    model,
    logits_of,
    infer,
    names: list[str],
    hop: int,
    fps: float,
    pad_to_class: dict[int, int],
    pos_weight: list[float],
    floor: bool = False,
) -> int:
    """학습 흐름. logits_of(파형 배치) → (배치, 프레임, 분류) 로짓, infer(파형) → (프레임, 분류) 점수."""
    import torch
    from torch.utils.data import DataLoader

    device = torch.device(args.device)
    if device.type == "cuda" and getattr(args, "mem_fraction", 0):
        # Windows에서 GPU 메모리가 넘치면 시스템 메모리로 새서 PC가 멈출 수 있어, 넘으면 이 프로세스만 오류로 끝나게 함
        torch.cuda.set_per_process_memory_fraction(args.mem_fraction)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    segments = SegmentSet(
        args.train,
        args.seconds,
        accomp_prob=args.accomp_prob,
        length=args.steps * args.batch,
        seed=args.seed,
    )
    loader = DataLoader(
        TrainSet(segments, hop, fps, len(names), pad_to_class, args.radiation, floor),
        batch_size=args.batch,
        num_workers=args.workers,
        persistent_workers=args.workers > 0,
        drop_last=True,
    )
    val_songs = load_manifest(args.val)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt,
        max_lr=args.lr,
        total_steps=args.steps,
        pct_start=max(0.05, 2.0 / args.steps),
        anneal_strategy="cos",
    )
    weight = torch.tensor(pos_weight, dtype=torch.float32, device=device) * args.pos_scale
    log = out / "train_log.jsonl"
    step, best = 0, -1.0
    last = out / "last.pt"

    def run_eval() -> dict:
        model.eval()
        with torch.no_grad():
            val = evaluate(infer, val_songs, names, fps)
        model.train()
        return val

    if last.is_file():
        state = torch.load(last, map_location=device)
        model.load_state_dict(state["model_state_dict"])
        opt.load_state_dict(state["optimizer"])
        sched.load_state_dict(state["scheduler"])
        step, best = int(state["step"]), float(state["best"])
        print(f"[train] {last}에서 이어 감 (스텝 {step}, 최고 {best:.4f})", flush=True)
    else:
        saved = {
            k: v for k, v in vars(args).items() if isinstance(v, (str, int, float, bool, list))
        }
        (out / "args.json").write_text(json.dumps(saved, indent=1), encoding="utf-8")
        base = run_eval()
        best = base["f1"]
        torch.save({"model_state_dict": model.state_dict(), "step": 0}, out / "best.pt")
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"step": 0, "val": base}) + "\n")
        per = " ".join(f"{k[:4]} {v['f1']:.3f}" for k, v in base.items() if k != "f1")
        print(f"[train] 학습 전 검증 8패드 F1 {best:.4f} | {per}", flush=True)

    model.train()
    scaler = torch.amp.GradScaler(device.type, enabled=args.amp)
    running, t0 = 0.0, time.perf_counter()
    for audio, target in loader:
        if step >= args.steps:
            break
        audio, target = audio.to(device), target.to(device)
        with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=args.amp):
            logits = logits_of(audio)
            n = min(logits.shape[1], target.shape[1])
            loss = focal_bce(logits[:, :n], target[:, :n], weight, args.gamma)
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        scaler.step(opt)
        scaler.update()
        sched.step()
        step += 1
        running += float(loss.detach())
        if step % args.log_every == 0:
            rate = (time.perf_counter() - t0) / args.log_every
            print(
                f"[train] 스텝 {step}/{args.steps} 손실 {running / args.log_every:.5f} "
                f"스텝당 {rate:.2f}초 lr {sched.get_last_lr()[0]:.2e}",
                flush=True,
            )
            running, t0 = 0.0, time.perf_counter()
        if step % args.eval_every == 0 or step == args.steps:
            val = run_eval()
            with open(log, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"step": step, "val": val}) + "\n")
            mark = ""
            if val["f1"] > best:
                best = val["f1"]
                torch.save({"model_state_dict": model.state_dict(), "step": step}, out / "best.pt")
                mark = " (최고)"
            per = " ".join(f"{k[:4]} {v['f1']:.3f}" for k, v in val.items() if k != "f1")
            print(f"[train] 스텝 {step} 검증 8패드 F1 {val['f1']:.4f}{mark} | {per}", flush=True)
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "optimizer": opt.state_dict(),
                    "scheduler": sched.state_dict(),
                    "step": step,
                    "best": best,
                },
                last,
            )
            t0 = time.perf_counter()
    print(f"[train] 끝. 최고 검증 8패드 F1 {best:.4f} → {out / 'best.pt'}", flush=True)
    # 끝났다는 표시. 데이터 읽기 작업을 정리하다 프로세스가 비정상 종료해도(Windows) 학습은 끝난 것으로 봄
    (out / "done.json").write_text(json.dumps({"step": step, "best": best}), encoding="utf-8")
    return 0
