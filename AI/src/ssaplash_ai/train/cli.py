"""`ssaplash-train` 명령.

uv run ssaplash-train adtof-finetune --config configs/train/adtof_tom_5cls.yaml --out data/models/adtof_ft/tom_5cls
uv run ssaplash-train adtof-finetune --config configs/train/adtof_tom_6cls.yaml --out data/models/adtof_ft/tom_6cls
uv run ssaplash-train adtof-finetune --config … --out data/models/adtof_ft/tom_6cls --resume  (끊긴 학습 이어 가기)
uv run ssaplash-train adtof-eval --checkpoint <pth> [<pth> …] --dataset <yaml> [<yaml> …] [--n-songs N] --out <폴더>
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path


def cmd_finetune(args: argparse.Namespace) -> int:
    from ssaplash_ai.train.adtof_finetune import TrainConfig, train

    cfg = TrainConfig.from_yaml(args.config)
    if args.device:
        cfg.device = args.device
    if args.max_epochs is not None:
        cfg.max_epochs = args.max_epochs
    if args.steps_per_epoch is not None:
        cfg.steps_per_epoch = args.steps_per_epoch
    if args.num_workers is not None:
        cfg.num_workers = args.num_workers
    best = train(cfg, Path(args.out), log=print, resume=args.resume)
    print(f"[train] 끝. {best}")
    return 0


def cmd_eval(args: argparse.Namespace) -> int:
    import torch

    from ssaplash_ai.train.adtof_data import class_names
    from ssaplash_ai.train.adtof_eval import (
        default_thresholds,
        evaluate_model,
        load_songs,
        write_results,
    )
    from ssaplash_ai.train.adtof_finetune import (
        build_model,
        default_base_checkpoint,
        read_checkpoint,
    )

    device = args.device if (args.device == "cpu" or torch.cuda.is_available()) else "cpu"
    checkpoints = [Path(c) for c in args.checkpoint] or [Path(default_base_checkpoint())]
    rows: list[dict] = []
    columns: list[str] = ["checkpoint", "dataset", "n_songs", "f1", "tom_f1"]
    for ds in args.dataset:
        songs = load_songs(ds, args.n_songs, args.seed)
        name = songs[0].dataset if songs else Path(ds).stem
        for ck in checkpoints:
            state, info = read_checkpoint(ck)
            classes = info.get("class_set", "five")
            model = build_model(len(class_names(classes)))
            model.load_state_dict(state)
            model.to(device)
            thresholds = info.get("thresholds") or default_thresholds(classes)
            if args.default_thresholds:
                thresholds = default_thresholds(classes)
            result = evaluate_model(model, songs, classes, thresholds, device)
            row = {"checkpoint": ck.name, "dataset": name, "n_songs": len(songs)}
            row.update(result.metrics())
            for k in row:
                if k not in columns:
                    columns.append(k)
            rows.append(row)
            print(
                f"[adtof-eval] {ck.name} · {name}: f1 {result.f1:.3f}, 탐 {result.tom_f1:.3f}, "
                + ", ".join(f"{k} {v:.3f}" for k, v in result.class_f1().items())
                + f", 페달 {result.pedal_f1:.3f} (정답 페달을 HIHAT으로 {result.confusion.pedal_as_hihat}개)"
            )
    csv_path, md_path = write_results(Path(args.out), rows, columns)
    print(f"[adtof-eval] {md_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ssaplash-train", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    ft = sub.add_parser("adtof-finetune", help="ADTOF Frame_RNN 파인튜닝")
    ft.add_argument("--config", required=True, help="configs/train/*.yaml")
    ft.add_argument("--out", required=True, help="best.pth·last.pth·log.csv·config.yaml을 둘 폴더")
    ft.add_argument("--device", default=None, help="설정의 device 대신 (cuda / cpu)")
    ft.add_argument("--max-epochs", type=int, default=None, help="설정값 대신 (짧게 시험할 때)")
    ft.add_argument("--steps-per-epoch", type=int, default=None, help="설정값 대신")
    ft.add_argument(
        "--num-workers", type=int, default=None, help="설정값 대신 (학습 둘을 같이 돌릴 때 줄임)"
    )
    ft.add_argument(
        "--resume",
        action="store_true",
        help="--out 폴더의 last.pth·log.csv에서 이어 학습 (없으면 처음부터)",
    )
    ft.set_defaults(func=cmd_finetune)

    ev = sub.add_parser("adtof-eval", help="체크포인트를 데이터셋에서 돌려 클래스별 F1")
    ev.add_argument(
        "--checkpoint", nargs="*", default=[], help=".pth 경로 (여러 개 가능, 없으면 기본 가중치)"
    )
    ev.add_argument("--dataset", nargs="+", required=True, help="데이터셋 yaml (여러 개 가능)")
    ev.add_argument("--n-songs", type=int, default=None, help="데이터셋마다 고정 시드로 이만큼만")
    ev.add_argument("--seed", type=int, default=0)
    ev.add_argument("--device", default="cuda")
    ev.add_argument(
        "--default-thresholds",
        action="store_true",
        help="체크포인트에 든 문턱값 대신 저장소 기본 문턱값으로",
    )
    ev.add_argument("--out", required=True, help="summary.csv·summary.md를 둘 폴더")
    ev.set_defaults(func=cmd_eval)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
