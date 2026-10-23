"""YourMT3+ 채보 스크립트 (별도 환경 `.venv-yourmt3`, 채보 설계 3-10절·1-3절).

코드는 GitHub이 아니라 HF Space `mimbres/YourMT3`에만 있음. options.repo_dir(기본 ext/YourMT3)에 Space의
amt/src·model_helper.py를, amt/logs/2024/<실험 이름>/checkpoints/에 HF 모델 저장소의 체크포인트를 받아 둠.
받기는 `python -I yourmt3_transcribe.py download` (판 고정, README).
흐름은 Space model_helper.transcribe와 같음: 모노 → 16kHz → 32767샘플(2.048초) 조각, 겹침 없음 →
inference_file(배치 8) → 채널별 토큰 풀기 → 노트 합치기. 오디오는 torchaudio.load 대신 soundfile로 읽음.
다악기 모델이라 MIDI를 쓰지 않고 노트 목록에서 드럼(is_drum)만 고름. 라벨은 GM 피치, 세기는 0/1만 배워 None.
체크포인트 경로가 실행 위치 기준(amt/logs)이라 모델을 올릴 때만 repo_dir로 옮겨 감. 한 프로세스에 모델 하나
(두 번 올리면 설정 dict가 섞인다는 보고, 저장소 이슈 18).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _protocol import run  # noqa: E402

DEFAULT_REPO = "ext/YourMT3"
HF_REPO = "mimbres/YourMT3"
# 코드는 Space, 체크포인트는 모델 저장소(Space 쪽 YPTF+Multi (PS) 폴더는 ptf_ 접두어가 붙어 앱 코드와 안 맞음)
SPACE_REVISION = "5e66c1ea173a8186e0d20432b841d3180cc015b5"
MODEL_REVISION = "e45ebd70398682d54b7bb1901a5216e18f3b1824"
PROJECT = "2024"
DEFAULT_MODEL = "YPTF.MoE+Multi (noPS)"

_MULTI = ["-tk", "mc13_full_plus_256", "-dec", "multi-t5", "-nl", "26", "-enc", "perceiver-tf"]
_SPEC = ["-ac", "spec", "-hop", "300", "-atc", "1"]
_MOE = ["-sqr", "1", "-ff", "moe", "-wf", "4", "-nmoe", "8", "-kmoe", "2", "-act", "silu"]
_MOE += ["-epe", "rope", "-rp", "1"]
# 모델 이름 → (실험 이름, 체크포인트 파일, 설정 인자). Space app.py 30~53행의 표 중 쓰는 것만
MODELS: dict[str, tuple[str, str, list[str]]] = {
    "YPTF.MoE+Multi (noPS)": (
        "mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops",
        "last.ckpt",
        _MULTI + _MOE + _SPEC,
    ),
    "YPTF+Multi (PS)": (
        "mc13_256_all_cross_v6_xk5_amp0811_edr005_attend_c_full_plus_2psn_nl26_sb_b26r_800k",
        "model.ckpt",
        _MULTI + _SPEC,
    ),
}


def checkpoint_file(repo_dir: Path, model_name: str) -> Path:
    exp_id, ckpt, _ = MODELS[model_name]
    return repo_dir / "amt" / "logs" / PROJECT / exp_id / "checkpoints" / ckpt


def drum_hits(notes) -> list:
    """다악기 노트 목록 → 드럼 노트만 시각순 [시각, GM 피치, None]. 세기는 0/1이라 버림."""
    hits = [[float(n.onset), int(n.pitch), None] for n in notes if n.is_drum]
    return sorted(hits, key=lambda h: (h[0], h[1]))


def load(options: dict, device: str):
    repo_dir = Path(options.get("repo_dir") or DEFAULT_REPO).resolve()
    model_name = options.get("variant") or DEFAULT_MODEL
    if model_name not in MODELS:
        raise ValueError(f"모르는 YourMT3+ 모델: {model_name} (가능: {', '.join(MODELS)})")
    ckpt = checkpoint_file(repo_dir, model_name)
    if not (repo_dir / "model_helper.py").is_file() or not ckpt.is_file():
        raise FileNotFoundError(
            f"YourMT3+ 코드나 체크포인트가 없음: {ckpt} "
            f"(python -I scripts/transcribers_ext/yourmt3_transcribe.py download --repo-dir {repo_dir})"
        )
    sys.path.insert(0, str(repo_dir / "amt" / "src"))
    sys.path.insert(0, str(repo_dir))
    import torch

    exp_id, ckpt_name, extra = MODELS[model_name]
    # -pr는 추론에 안 쓰는 Trainer에만 들어감. 앱의 '16' 대신 '32'로 두어 CPU에서도 Trainer 생성이 막히지 않게 함
    args = [f"{exp_id}@{ckpt_name}", "-p", PROJECT, *extra, "-pr", "32"]
    cwd = Path.cwd()
    os.chdir(repo_dir)
    try:
        from model_helper import load_model_checkpoint

        model = load_model_checkpoint(args=args, device="cpu")
    finally:
        os.chdir(cwd)
    dev = device if (device.startswith("cuda") and torch.cuda.is_available()) else "cpu"
    model.to(dev)
    n_params = sum(p.numel() for p in model.parameters())
    return (model, dev), f"{HF_REPO}/{exp_id}@{ckpt_name}", n_params


def transcribe(handle, wav_path: str, device: str, options: dict) -> list:
    import soundfile as sf
    import torch
    import torchaudio
    from utils.audio import slice_padded_array
    from utils.event2note import merge_zipped_note_events_and_ties_to_notes
    from utils.note2event import mix_notes

    model, dev = handle
    sr_model = int(model.audio_cfg["sample_rate"])
    seg_len = int(model.audio_cfg["input_frames"])
    audio, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    x = torchaudio.functional.resample(
        torch.from_numpy(audio.mean(axis=1)).unsqueeze(0), sr, sr_model
    )
    # numpy로 넘김. torch 텐서는 길이가 조각 길이의 배수일 때 strides 접근에서 막힘
    segs = slice_padded_array(x.numpy(), seg_len, seg_len)
    segs = torch.from_numpy(segs.astype("float32")).unsqueeze(1).to(dev)
    with torch.inference_mode():
        tokens, _ = model.inference_file(
            bsz=int(options.get("batch_size") or 8), audio_segments=segs
        )
    starts = [seg_len * i / sr_model for i in range(segs.shape[0])]
    notes_by_channel = []
    for ch in range(model.task_manager.num_decoding_channels):
        zipped, _, _ = model.task_manager.detokenize_list_batches(
            [arr[:, ch, :] for arr in tokens], starts, return_events=True
        )
        notes_ch, _ = merge_zipped_note_events_and_ties_to_notes(zipped)
        notes_by_channel.append(notes_ch)
    notes = mix_notes(notes_by_channel)
    if not notes:
        # 체크포인트와 설정 인자가 안 맞으면 오류 없이 빈 출력이 나옴(저장소 이슈 3)
        raise RuntimeError("노트가 하나도 안 나옴. 체크포인트와 설정 인자가 맞는지 확인")
    return drum_hits(notes)


def download(argv: list[str]) -> int:
    """코드(Space)와 체크포인트(모델 저장소)를 고정 판으로 받음. 이미 있는 파일은 건너뜀."""
    parser = argparse.ArgumentParser(prog="yourmt3_transcribe.py download")
    parser.add_argument("--repo-dir", default=DEFAULT_REPO)
    parser.add_argument("--models", nargs="+", default=list(MODELS), choices=list(MODELS))
    args = parser.parse_args(argv)
    from huggingface_hub import snapshot_download

    repo_dir = Path(args.repo_dir)
    snapshot_download(
        repo_id=HF_REPO,
        repo_type="space",
        revision=SPACE_REVISION,
        allow_patterns=["amt/src/**", "model_helper.py"],
        local_dir=repo_dir,
    )
    patterns = [checkpoint_file(Path("."), m).relative_to("amt").as_posix() for m in args.models]
    snapshot_download(
        repo_id=HF_REPO,
        repo_type="model",
        revision=MODEL_REVISION,
        allow_patterns=patterns,
        local_dir=repo_dir / "amt",
    )
    for m in args.models:
        path = checkpoint_file(repo_dir, m)
        print(f"{m}: {path} ({path.stat().st_size / 1e6:.0f}MB)")
    return 0


if __name__ == "__main__":
    if sys.argv[1:2] == ["download"]:
        sys.exit(download(sys.argv[2:]))
    sys.exit(run(load, transcribe))
