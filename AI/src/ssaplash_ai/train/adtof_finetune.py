"""ADTOF Frame_RNN 파인튜닝 학습 루프.

- 모델 구조는 ADTOF-pytorch 포트 그대로. 출력층만 클래스 수(5·6·7·9)에 맞추고 5클래스 가중치에서 복사해 초기화
- 손실: 프레임·클래스별 이진 교차 엔트로피. 양성 가중치 = 클래스 가중치
- 에폭마다 검증 F1을 측정해 select_metric이 오르고 5가지 클래스 F1이 기준값보다 guard_drop 넘게 떨어지지 않았으면 best.pth
- 검증 점수가 안 오르면 학습률 ×0.2, 더 안 오르면 종료. 끝나면 클래스별 문턱값을 맞춰 model_info에 기록
- 끊긴 학습은 resume으로 last.pth·log.csv에서 이어 감
체크포인트 형식은 {'model_weights': state_dict, 'model_info': {...}}.
"""

from __future__ import annotations

import csv
import datetime as dt
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import yaml
from adtof_pytorch.model import ADTOFFrameRNN
from torch.utils.data import DataLoader

from ssaplash_ai.bench.datasets import SongItem
from ssaplash_ai.train.adtof_data import (
    FIVE_ORDER,
    FIVE_PEDAL_CYM_PITCHES,
    FIVE_PEDAL_PITCHES,
    FIVE_PITCHES,
    WINDOW_FRAMES,
    DatasetSpec,
    SongPool,
    WindowConfig,
    WindowDataset,
    class_names,
    loss_mask,
    pedal_indices,
    tom_indices,
)
from ssaplash_ai.train.adtof_eval import (
    compute_song_activations,
    default_thresholds,
    evaluate_activations,
    evaluate_model,
    fit_thresholds,
    load_songs,
)

N_BINS = 84
# ADTOF 원본 Frame_RNN 클래스 가중치 (킥·스네어·탐·하이햇·심벌)
ADTOF_WEIGHTS_5: tuple[float, ...] = (1.078, 1.353, 3.414, 1.144, 1.768)
# 9패드 가중치: 탐 3개는 탐 값, 크래시·라이드는 심벌 값, 페달은 하이햇 값
ADTOF_WEIGHTS_PADS: tuple[float, ...] = (
    1.078,
    1.353,
    3.414,
    3.414,
    3.414,
    1.144,
    1.768,
    1.768,
    1.144,
)
ADTOF_WEIGHTS_FIVE_PEDAL: tuple[float, ...] = (*ADTOF_WEIGHTS_5, 1.144)
ADTOF_WEIGHTS_FIVE_PEDAL_CYM: tuple[float, ...] = (*ADTOF_WEIGHTS_FIVE_PEDAL, 1.768)
# 5클래스 출력 행 → 넓힌 출력 행 복사 원본. 키는 넓힌 뒤 클래스 수
# 9: KICK·SNARE·SMALL·MID·FLOOR·HIHAT·CRASH·RIDE·HIHAT_PEDAL, 6: 킥·스네어·탐·하이햇·심벌·페달,
# 7: 킥·스네어·탐·하이햇·크래시·페달·라이드
FROM_FIVE: dict[int, tuple[int, ...]] = {
    9: (0, 1, 2, 2, 2, 3, 4, 4, 3),
    6: (0, 1, 2, 3, 4, 3),
    7: (0, 1, 2, 3, 4, 3, 4),
}
WEIGHTS_BY_SET: dict[str, tuple[float, ...]] = {
    "five": ADTOF_WEIGHTS_5,
    "five_pedal": ADTOF_WEIGHTS_FIVE_PEDAL,
    "five_pedal_cym": ADTOF_WEIGHTS_FIVE_PEDAL_CYM,
    "pads": ADTOF_WEIGHTS_PADS,
}

Logger = Callable[[str], None]


@dataclass
class ValSpec:
    path: Path
    n_songs: int | None = None


@dataclass
class TrainConfig:
    """configs/train/*.yaml 한 파일."""

    train_datasets: list[DatasetSpec]
    val_datasets: list[ValSpec]
    base_checkpoint: str | None = None
    classes: str = "five"
    window_frames: int = WINDOW_FRAMES
    batch_size: int = 32
    steps_per_epoch: int = 2000
    max_epochs: int = 20
    learning_rate: float = 1e-4
    lr_reduce_patience: int = 2
    early_stop_patience: int = 4
    label_radiation: int = 1
    class_weights: list[float] | None = None
    tom_weight_mult: float = 2.0
    pedal_weight_mult: float = 2.0
    tom_window_frac: float = 0.5
    accomp_mix_prob: float = 0.3
    accomp_gain_range: tuple[float, float] = (0.05, 0.3)
    gain_db_range: tuple[float, float] = (-6.0, 6.0)
    freeze_cnn: bool = False
    eval_every: int = 1
    select_metric: str = "tom_f1"
    guard_drop: float = 0.02
    fit_thresholds: bool = True
    windows_per_song: int = 8
    seed: int = 0
    num_workers: int = 8
    device: str = "cuda"
    raw: dict = field(default_factory=dict, repr=False)

    @classmethod
    def from_yaml(cls, path: str | Path) -> TrainConfig:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"학습 설정이 비어 있음: {path}")
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict) -> TrainConfig:
        known = {f for f in cls.__dataclass_fields__ if f != "raw"}
        unknown = set(raw) - known
        if unknown:
            raise ValueError(f"학습 설정에 모르는 키: {sorted(unknown)}")
        kw = dict(raw)
        kw["train_datasets"] = [
            DatasetSpec(
                Path(d["path"]),
                float(d.get("weight", 1.0)),
                tuple(str(c) for c in d.get("ignore_classes") or ()),
            )
            for d in raw["train_datasets"]
        ]
        kw["val_datasets"] = [
            ValSpec(Path(d["path"]), d.get("n_songs")) for d in raw.get("val_datasets", [])
        ]
        for key in ("accomp_gain_range", "gain_db_range"):
            if key in kw:
                kw[key] = (float(kw[key][0]), float(kw[key][1]))
        cfg = cls(**kw, raw=dict(raw))
        class_names(cfg.classes)
        for spec in cfg.train_datasets:
            loss_mask(cfg.classes, spec.ignore_classes)
        return cfg

    def window_config(self) -> WindowConfig:
        return WindowConfig(
            classes=self.classes,
            window_frames=self.window_frames,
            label_radiation=self.label_radiation,
            tom_window_frac=self.tom_window_frac,
            accomp_mix_prob=self.accomp_mix_prob,
            accomp_gain_range=self.accomp_gain_range,
            gain_db_range=self.gain_db_range,
        )

    def positive_weights(self) -> torch.Tensor:
        """클래스별 양성 가중치. 탐 채널은 tom_weight_mult, 페달 채널은 pedal_weight_mult를 곱함."""
        n = len(class_names(self.classes))
        base = self.class_weights or WEIGHTS_BY_SET[self.classes]
        if len(base) != n:
            raise ValueError(f"class_weights 길이 {len(base)} ≠ 클래스 수 {n}")
        w = torch.tensor(base, dtype=torch.float32)
        for k in tom_indices(self.classes):
            w[k] *= self.tom_weight_mult
        for k in pedal_indices(self.classes):
            w[k] *= self.pedal_weight_mult
        return w


# ---------- 모델·체크포인트 ----------


def build_model(n_classes: int, n_bins: int = N_BINS) -> ADTOFFrameRNN:
    """ADTOF Frame_RNN. 기본 가중치 파일의 구조(conv 32·64, GRU 60×3, context 9)와 같음."""
    return ADTOFFrameRNN(
        n_bins=n_bins,
        n_channels=1,
        conv_filters=[32, 64],
        gru_units=[60, 60, 60],
        context=9,
        output_classes=n_classes,
        same_padding=True,
        dropout_rate=0.3,
    )


def read_checkpoint(path: str | Path) -> tuple[dict, dict]:
    """(state_dict, model_info). model_info가 없는 옛 파일은 빈 dict."""
    ck = torch.load(str(path), map_location="cpu", weights_only=False)
    if isinstance(ck, dict) and "model_weights" in ck:
        return dict(ck["model_weights"]), dict(ck.get("model_info") or {})
    return dict(ck), {}


def expand_output_layer(state: dict, n_classes: int) -> dict:
    """출력층 행을 FROM_FIVE대로 복사해 5 → 6·7·9클래스로 넓힘. 이미 맞으면 그대로."""
    w = state["output_layer.weight"]
    if w.shape[0] == n_classes:
        return state
    if w.shape[0] != 5 or n_classes not in FROM_FIVE:
        raise ValueError(f"출력층 {w.shape[0]}클래스를 {n_classes}클래스로 바꾸는 규칙이 없음")
    idx = torch.tensor(FROM_FIVE[n_classes])
    out = dict(state)
    out["output_layer.weight"] = w[idx].clone()
    out["output_layer.bias"] = state["output_layer.bias"][idx].clone()
    return out


def load_base(model: ADTOFFrameRNN, path: str | Path, n_classes: int) -> dict:
    """기본(또는 이전) 체크포인트를 모델에 넣음. 클래스 수가 다르면 출력층만 복사 초기화."""
    state, info = read_checkpoint(path)
    state = expand_output_layer(state, n_classes)
    model.load_state_dict(state, strict=True)
    return info


def default_base_checkpoint() -> str:
    import adtof_pytorch as adtof

    path = adtof.get_default_weights_path()
    if not path or not Path(path).is_file():
        raise FileNotFoundError("adtof_pytorch 기본 가중치 파일이 없음")
    return path


def model_info(classes: str, thresholds: Sequence[float], extra: dict | None = None) -> dict:
    names = class_names(classes)
    info = {
        "architecture": "Frame_RNN",
        "n_bins": N_BINS,
        "conv_filters": [32, 64],
        "gru_units": [60, 60, 60],
        "output_classes": len(names),
        "n_classes": len(names),
        "class_set": classes,
        "classes": _class_labels(classes),
        "class_names": list(names),
        "thresholds": [float(t) for t in thresholds],
        "created": dt.datetime.now().isoformat(timespec="seconds"),
    }
    info.update(extra or {})
    return info


def _class_labels(classes: str) -> list:
    """어댑터가 원래 라벨로 쓰는 클래스 이름. five 계열은 MIDI 피치, pads는 패드 이름."""
    if classes == "five":
        return list(FIVE_PITCHES)
    if classes == "five_pedal":
        return list(FIVE_PEDAL_PITCHES)
    if classes == "five_pedal_cym":
        return list(FIVE_PEDAL_CYM_PITCHES)
    return list(class_names(classes))


def guard_ok(metrics: dict[str, float], reference: dict[str, float], drop: float) -> bool:
    """5가지 클래스 F1이 모두 기준값보다 drop 넘게 떨어지지 않았는지."""
    return all(metrics[f"f1_{k}"] >= reference[f"f1_{k}"] - drop - 1e-9 for k in FIVE_ORDER)


def reference_metrics(base: str | Path, songs: Sequence[SongItem], device: str) -> dict[str, float]:
    """기본(시작) 가중치를 5클래스로 검증한 점수. best.pth 선택 기준값.

    출력층이 5개가 아닌 체크포인트에서 이어 학습하면 그 체크포인트의 클래스 묶음으로 잼.
    """
    state, info = read_checkpoint(base)
    classes = (
        "five" if state["output_layer.weight"].shape[0] == 5 else info.get("class_set", "five")
    )
    ref = build_model(len(class_names(classes)))
    ref.load_state_dict(state, strict=True)
    ref.to(device)
    return evaluate_model(ref, songs, classes, None, device).metrics()


def save_checkpoint(path: Path, model: torch.nn.Module, info: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
    torch.save({"model_weights": state, "model_info": info}, str(path))


# ---------- 손실 ----------


def weighted_bce(
    pred: torch.Tensor,
    target: torch.Tensor,
    pos_weight: torch.Tensor,
    mask: torch.Tensor | None = None,
) -> torch.Tensor:
    """sigmoid 출력에 대한 이진 교차 엔트로피. 양성 프레임의 가중치가 pos_weight, 음성은 1.

    mask (배치, 클래스)가 있으면 0인 채널의 손실을 빼고, 남은 원소 수로 나눈 평균.
    """
    weight = 1.0 + (pos_weight - 1.0) * target
    if mask is None:
        return F.binary_cross_entropy(pred, target, weight=weight)
    m = mask[:, None, :].to(pred.dtype).expand_as(pred)
    total = F.binary_cross_entropy(pred, target, weight=weight * m, reduction="sum")
    return total / m.sum().clamp_min(1.0)


def set_freeze_cnn(model: ADTOFFrameRNN, freeze: bool) -> None:
    for p in model.cnn_blocks.parameters():
        p.requires_grad = not freeze


# ---------- 학습 ----------


@dataclass
class TrainState:
    epoch: int = 0
    step: int = 0
    best_metric: float = -1.0
    best_epoch: int = -1
    bad_epochs: int = 0
    lr: float = 0.0


@dataclass
class ResumePoint:
    """끊긴 학습을 이어 갈 자리. log.csv를 처음부터 다시 읽어 계산."""

    state: TrainState
    start_epoch: int
    sec: int
    fieldnames: list[str]
    config: dict


def resume_point(out_dir: Path, cfg: TrainConfig) -> ResumePoint | None:
    """out_dir에 last.pth와 에폭 줄이 있는 log.csv가 있으면 이어 갈 자리, 없으면 None(처음부터).

    최고점·안 오른 에폭 수는 학습 루프의 consider와 같은 규칙으로, 학습률은 마지막 줄 값에
    루프 끝의 줄이기 규칙을 한 번 더 적용해 다시 계산.
    """
    log_path = out_dir / "log.csv"
    if not ((out_dir / "last.pth").is_file() and log_path.is_file()):
        return None
    with log_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])
    epochs = [r for r in rows if int(r["epoch"]) >= 0]
    if not epochs:
        return None
    state = TrainState(lr=cfg.learning_rate)
    key = f"val_{cfg.select_metric}"
    for r in rows:
        epoch = int(r["epoch"])
        if r.get("best") == "1":
            state.best_metric, state.best_epoch, state.bad_epochs = float(r[key]), epoch, 0
        elif r.get("best") == "0" and epoch >= 0:
            state.bad_epochs += 1
    last = epochs[-1]
    state.epoch, state.step, state.lr = int(last["epoch"]), int(last["step"]), float(last["lr"])
    if (
        state.bad_epochs < cfg.early_stop_patience
        and state.bad_epochs
        and state.bad_epochs % cfg.lr_reduce_patience == 0
    ):
        state.lr *= 0.2
    config_path = out_dir / "config.yaml"
    config = (
        yaml.safe_load(config_path.read_text(encoding="utf-8")) if config_path.is_file() else {}
    )
    return ResumePoint(state, state.epoch + 1, int(float(last["sec"])), fieldnames, config or {})


def train(
    cfg: TrainConfig,
    out_dir: Path,
    log: Logger = print,
    val_songs: Sequence[SongItem] | None = None,
    resume: bool = False,
) -> Path:
    """학습 전체. best.pth 경로를 돌려줌. val_songs를 주면 val_datasets 대신 씀(테스트용).

    resume이면 out_dir의 last.pth·log.csv에서 이어 학습(없으면 처음부터). 옵티마이저 상태는
    저장하지 않으므로 새로 시작.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(cfg.seed)
    np.random.seed(cfg.seed)
    device = cfg.device if (cfg.device == "cpu" or torch.cuda.is_available()) else "cpu"
    if device != cfg.device:
        log(f"경고: {cfg.device}를 쓸 수 없어 cpu로 학습")
    n_classes = len(class_names(cfg.classes))
    resume_at = resume_point(out_dir, cfg) if resume else None
    start_epoch = resume_at.start_epoch if resume_at else 0

    base = cfg.base_checkpoint or default_base_checkpoint()
    model = build_model(n_classes)
    load_base(model, base, n_classes)
    if resume_at:
        last_state, last_info = read_checkpoint(out_dir / "last.pth")
        model.load_state_dict(last_state, strict=True)
        if last_info.get("epoch") != resume_at.state.epoch:
            log(
                f"경고: last.pth는 에폭 {last_info.get('epoch')}, log.csv 마지막 줄은 에폭 "
                f"{resume_at.state.epoch}. last.pth 가중치로 에폭 {start_epoch}부터 이어 감"
            )
    set_freeze_cnn(model, cfg.freeze_cnn)
    model.to(device)

    pool = SongPool.from_specs(cfg.train_datasets)
    if resume_at:
        digest = resume_at.config.get("_songs_digest")
        if digest and digest != pool.digest():
            raise ValueError(
                f"이어 학습 멈춤: 학습 곡 해시 {pool.digest()}가 config.yaml의 {digest}와 다름"
            )
    # 이어 학습은 시드를 시작 에폭만큼 옮겨 앞 에폭과 같은 윈도를 다시 뽑지 않게 함
    dataset = WindowDataset(pool, cfg.window_config(), cfg.seed + start_epoch, cfg.windows_per_song)
    loader = DataLoader(
        dataset,
        batch_size=cfg.batch_size,
        num_workers=cfg.num_workers,
        persistent_workers=cfg.num_workers > 0,
    )
    if val_songs is None:
        val_songs = [
            s for spec in cfg.val_datasets for s in load_songs(spec.path, spec.n_songs, cfg.seed)
        ]
    if not val_songs:
        raise ValueError("검증 곡이 없음 (val_datasets)")
    log(
        f"[train] 학습 곡 {pool.n_songs}개(해시 {pool.digest()}), 검증 곡 {len(val_songs)}개, "
        f"클래스 {cfg.classes}({n_classes}), 장치 {device}, 기본 가중치 {Path(base).name}"
    )

    if resume_at and "_reference" in resume_at.config:
        reference = {k: float(v) for k, v in resume_at.config["_reference"].items()}
    else:
        reference = reference_metrics(base, val_songs, device)
    log(
        "[train] 기준값(기본 가중치 5클래스): "
        + ", ".join(f"{k} {reference[f'f1_{k}']:.3f}" for k in FIVE_ORDER)
        + f", 페달 {reference['pedal_f1']:.3f} (best.pth는 5가지 모두 −{cfg.guard_drop} 안일 때만)"
    )

    if resume_at:
        saved = dict(resume_at.config)
        saved["_resumed"] = [
            *saved.get("_resumed", []),
            {"from_epoch": start_epoch, "at": dt.datetime.now().isoformat(timespec="seconds")},
        ]
    else:
        saved = {
            **cfg.raw,
            "_songs_digest": pool.digest(),
            "_base_checkpoint": str(base),
            "_reference": {k: float(v) for k, v in reference.items()},
        }
    (out_dir / "config.yaml").write_text(
        yaml.safe_dump(saved, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    pos_weight = cfg.positive_weights().to(device)
    params = [p for p in model.parameters() if p.requires_grad]
    state = resume_at.state if resume_at else TrainState(lr=cfg.learning_rate)
    opt = torch.optim.Adam(params, lr=state.lr)
    thresholds = default_thresholds(cfg.classes)
    extra = {"base_checkpoint": str(base), "train_config": cfg.raw, "reference": reference}

    log_path = out_dir / "log.csv"
    writer: csv.DictWriter | None = None
    if resume_at:
        log_file = log_path.open("a", newline="", encoding="utf-8")
        writer = csv.DictWriter(log_file, fieldnames=resume_at.fieldnames)
    else:
        log_file = log_path.open("w", newline="", encoding="utf-8")

    def write_row(row: dict) -> None:
        nonlocal writer
        if writer is None:
            writer = csv.DictWriter(log_file, fieldnames=list(row))
            writer.writeheader()
        writer.writerow(row)
        log_file.flush()

    def consider(result, epoch: int, row: dict) -> None:
        """검증 결과로 best.pth 갱신 여부를 정하고 row에 val_*·best·guard를 채움."""
        metrics = result.metrics()
        row.update({f"val_{k}": v for k, v in metrics.items()})
        metric = metrics[cfg.select_metric]
        ok = guard_ok(metrics, reference, cfg.guard_drop)
        row["guard"] = int(ok)
        if ok and metric > state.best_metric:
            state.best_metric, state.best_epoch, state.bad_epochs = metric, epoch, 0
            save_checkpoint(
                out_dir / "best.pth",
                model,
                model_info(
                    cfg.classes,
                    thresholds,
                    {**extra, "step": state.step, "epoch": epoch, "val_metrics": metrics},
                ),
            )
            row["best"] = 1
        else:
            if epoch >= 0:
                state.bad_epochs += 1
            row["best"] = 0
        pedal = f" 페달 {result.pedal_f1:.3f}" if cfg.classes != "five" else ""
        if "f1_crash" in metrics:
            pedal += f" 크래시 {metrics['f1_crash']:.3f} 라이드 {metrics['f1_ride']:.3f}"
        guard = "" if ok else " (기준값보다 0.02 넘게 떨어진 클래스 있음, 선택 안 함)"
        log(
            f"[train] 에폭 {epoch} 손실 {row['loss']:.4f} 검증 f1 {result.f1:.3f} "
            f"탐 {result.tom_f1:.3f}{pedal} "
            f"({cfg.select_metric} 최고 {state.best_metric:.3f}@{state.best_epoch}){guard}"
        )

    if resume_at:
        t0 = time.time() - resume_at.sec  # log.csv의 sec 열이 끊기기 전부터 이어지게
        finished = state.bad_epochs >= cfg.early_stop_patience or start_epoch >= cfg.max_epochs
        log(
            f"[train] 이어 학습: 에폭 {start_epoch}부터, {cfg.select_metric} 최고 "
            f"{state.best_metric:.3f}@{state.best_epoch}, 안 오른 에폭 {state.bad_epochs}, "
            f"학습률 {state.lr:.2e}. 옵티마이저 상태는 새로 시작"
            + (". 이미 끝난 학습이라 문턱값만 맞춤" if finished else "")
        )
        epochs = range(0) if finished else range(start_epoch, cfg.max_epochs)
    else:
        t0 = time.time()
        # 학습 전 시작 가중치 (6·7·9클래스는 출력층을 복사한 상태라 하이햇·탐이 겹쳐 나올 수 있음)
        start_row: dict = {"epoch": -1, "step": 0, "lr": state.lr, "loss": float("nan"), "sec": 0}
        consider(evaluate_model(model, val_songs, cfg.classes, thresholds, device), -1, start_row)
        write_row(start_row)
        epochs = range(cfg.max_epochs)

    it = iter(loader) if len(epochs) else None
    for epoch in epochs:
        state.epoch = epoch
        model.train()
        losses = []
        for _ in range(cfg.steps_per_epoch):
            x, y, m = next(it)
            x, y, m = x.to(device), y.to(device), m.to(device)
            pred = model(x)
            loss = weighted_bce(pred, y, pos_weight, m)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            losses.append(loss.item())
            state.step += 1
        row: dict = {
            "epoch": epoch,
            "step": state.step,
            "lr": state.lr,
            "loss": float(np.mean(losses)),
            "sec": round(time.time() - t0),
        }
        if (epoch + 1) % cfg.eval_every == 0:
            consider(evaluate_model(model, val_songs, cfg.classes, thresholds, device), epoch, row)
        save_checkpoint(
            out_dir / "last.pth",
            model,
            model_info(cfg.classes, thresholds, {**extra, "step": state.step, "epoch": epoch}),
        )
        write_row(row)
        if state.bad_epochs >= cfg.early_stop_patience:
            log(f"[train] {cfg.early_stop_patience}에폭 동안 안 올라 종료")
            break
        if state.bad_epochs and state.bad_epochs % cfg.lr_reduce_patience == 0:
            state.lr *= 0.2
            for g in opt.param_groups:
                g["lr"] = state.lr
            log(f"[train] 학습률 {state.lr:.2e}로 낮춤")
    log_file.close()

    best_path = out_dir / "best.pth"
    if not best_path.is_file():
        log(
            "[train] 경고: 기준값 조건을 넘는 에폭이 없어 마지막 가중치를 best.pth로 저장함. "
            "log.csv의 guard 열을 볼 것"
        )
        save_checkpoint(best_path, model, model_info(cfg.classes, thresholds, extra))
    if cfg.fit_thresholds:
        _refit_thresholds(best_path, val_songs, cfg.classes, device, log)
    return best_path


def _refit_thresholds(
    best_path: Path, val_songs: Sequence[SongItem], classes: str, device: str, log: Logger
) -> list[float]:
    state, info = read_checkpoint(best_path)
    model = build_model(len(class_names(classes)))
    model.load_state_dict(state)
    model.to(device)
    acts = compute_song_activations(model, val_songs, device)
    before = evaluate_activations(acts, classes, info["thresholds"])
    fitted = fit_thresholds(acts, classes)
    after = evaluate_activations(acts, classes, fitted)
    info["thresholds"] = fitted
    info["thresholds_default"] = default_thresholds(classes)
    info["val_metrics_fitted"] = after.metrics()
    torch.save({"model_weights": state, "model_info": info}, str(best_path))
    log(
        f"[train] 문턱값 맞춤 {[round(t, 2) for t in fitted]}: 검증 f1 {before.f1:.3f} → {after.f1:.3f}, "
        f"탐 {before.tom_f1:.3f} → {after.tom_f1:.3f}"
    )
    return fitted


def config_summary(cfg: TrainConfig) -> dict:
    """로그·문서용 요약."""
    d = asdict(cfg)
    d.pop("raw", None)
    d["train_datasets"] = [{"path": str(s.path), "weight": s.weight} for s in cfg.train_datasets]
    d["val_datasets"] = [{"path": str(s.path), "n_songs": s.n_songs} for s in cfg.val_datasets]
    return d
