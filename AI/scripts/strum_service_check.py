"""서비스 STRUM 어댑터가 실험 때 저장한 노트와 같은 노트를 내는지 확인.

채보 워커가 쓰는 어댑터(strum_crnn)를 곡 목록의 드럼 트랙에 돌려
1. 곡마다 채보 시간과 최대 GPU 메모리를 측정
2. `--reference`가 있으면 실험 노트(킥 규칙까지 적용된 피크, `<reference>/<데이터셋>/<곡>.npz`)에 yaml 문턱값을 적용한 것과
   비교. 같은 패드이고 시각 차이가 --tolerance-ms 이하면 같은 노트. 일치율 = 2 × 같은 노트 ÷ (실험 노트 + 서비스 노트)
   실험 채점은 서버로 보낸 음원(채널 평균 뒤 16비트로 다시 쓴 모노 flac)으로 했음. `--mono16`을 주면 같은 형식으로
   바꿔 넣어 실험 노트와 같은 입력이 됨. 안 주면 워커와 같이 드럼 트랙을 그대로 넣음
3. `--out`이 있으면 서비스 노트를 실험 노트 형식(onset, label `p3/<패드>`, velocity 1000)으로 저장. 정답 채점은
   실험 채점 스크립트가 이 폴더를 읽어서 함

곡 목록은 실험 때 만든 json(`name`, `dataset`, `songs[].song_id`, `songs[].drums`).

  uv run python scripts/strum_service_check.py --manifest data/ext_train/test31.json \
      --reference data/results/ext_notes/strum_p3_RE_sg --out data/results/ext_notes/strum_service
"""

from __future__ import annotations

import argparse
import io
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf

DEFAULT_MODEL = "configs/bench/transcribers/strum/strum_crnn_songsterr_egmd.yaml"
LABEL_PREFIX = "p3/"


def read_audio(path: str, mono16: bool = False) -> tuple[np.ndarray, int]:
    """음원 → (채널, 샘플) float32, 표본화 주파수. mono16이면 채널 평균을 16비트로 반올림한 모노."""
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    if mono16:
        buffer = io.BytesIO()
        sf.write(buffer, audio.mean(axis=1), sample_rate, format="FLAC", subtype="PCM_16")
        buffer.seek(0)
        audio, sample_rate = sf.read(buffer, dtype="float32", always_2d=True)
    return np.ascontiguousarray(audio.T), int(sample_rate)


def reference_notes(path: Path, thresholds: dict[str, float]) -> dict[str, np.ndarray]:
    """실험 노트 파일에 패드별 문턱값을 적용한 {패드: 시각 오름차순}."""
    z = np.load(path)
    label, onset, score = z["label"].astype(str), z["onset"], z["velocity"]
    out = {}
    for pad, thr in thresholds.items():
        keep = (label == LABEL_PREFIX + pad) & (score >= int(round(thr * 1000)))
        out[pad] = np.sort(onset[keep])
    return out


def count_same(a: np.ndarray, b: np.ndarray, tolerance: float) -> int:
    """오름차순 시각 두 목록에서 tolerance 안으로 일대일로 짝지어지는 개수."""
    i = j = same = 0
    while i < len(a) and j < len(b):
        if abs(a[i] - b[j]) <= tolerance:
            same, i, j = same + 1, i + 1, j + 1
        elif a[i] < b[j]:
            i += 1
        else:
            j += 1
    return same


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", action="append", required=True, help="곡 목록 json. 여러 번")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="채보 모델 yaml")
    ap.add_argument("--reference", type=Path, default=None, help="비교할 실험 노트 폴더")
    ap.add_argument("--out", type=Path, default=None, help="서비스 노트를 저장할 폴더")
    ap.add_argument("--tolerance-ms", type=float, default=1.0)
    ap.add_argument(
        "--mono16", action="store_true", help="실험 채점 때와 같은 모노 16비트 음원으로 바꿔 넣음"
    )
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--limit", type=int, default=None, help="목록마다 앞에서 이 곡 수만")
    args = ap.parse_args()

    from ssaplash_ai.bench.transcribers import TranscriberConfig, create_transcriber

    config = TranscriberConfig.from_yaml(args.model)
    transcriber = create_transcriber(config, args.device)
    load_sec = transcriber.load()
    thresholds = {str(k): float(v) for k, v in config.rules["thresholds"].items()}
    print(f"[strum_check] {config.name} 올리기 {load_sec:.1f}초 장치 {transcriber.device}")

    try:
        import torch

        cuda = torch.cuda.is_available() and args.device.startswith("cuda")
    except ImportError:
        torch, cuda = None, False

    failed = False
    for manifest in args.manifest:
        meta = json.loads(Path(manifest).read_text(encoding="utf-8"))
        songs = meta["songs"][: args.limit]
        seconds, lengths, peak_mb = [], [], 0.0
        n_ref = n_svc = n_same = n_gain = n_missing = 0
        for song in songs:
            audio, sample_rate = read_audio(song["drums"], args.mono16)
            if cuda:
                torch.cuda.reset_peak_memory_stats()
            start = time.perf_counter()
            hits = transcriber.transcribe(audio, sample_rate).hits_pred
            if cuda:
                torch.cuda.synchronize()
                peak_mb = max(peak_mb, torch.cuda.max_memory_allocated() / 2**20)
            seconds.append(time.perf_counter() - start)
            lengths.append(audio.shape[1] / sample_rate)
            n_gain += int(bool(transcriber.last_kick_gain and transcriber.last_kick_gain.applied))
            file = f"{song['song_id'].replace('/', '__')}.npz"
            if args.out is not None:
                dst = args.out / meta["dataset"] / file
                dst.parent.mkdir(parents=True, exist_ok=True)
                np.savez(
                    dst,
                    onset=hits["time_sec"].astype(np.float64),
                    label=np.array([LABEL_PREFIX + str(p) for p in hits["pad"]], dtype="U24"),
                    velocity=np.full(len(hits), 1000, dtype=np.int32),
                    seconds=float(seconds[-1]),
                    duration=float(lengths[-1]),
                    checkpoint=config.name,
                )
            if args.reference is None:
                continue
            ref_path = args.reference / meta["dataset"] / file
            if not ref_path.is_file():
                n_missing += 1
                continue
            ref = reference_notes(ref_path, thresholds)
            for pad, ref_times in ref.items():
                svc_times = np.sort(hits["time_sec"][hits["pad"] == pad])
                n_ref += len(ref_times)
                n_svc += len(svc_times)
                n_same += count_same(ref_times, svc_times, args.tolerance_ms / 1000.0)
        sec = np.array(seconds)
        line = (
            f"[strum_check] {meta['name']} 곡 {len(songs)} 채보 초 중앙값 {np.median(sec):.2f} "
            f"최대 {sec.max():.2f} 곡 길이 대비 {sec.sum() / sum(lengths):.4f} "
            f"최대 GPU {peak_mb:.0f}MiB 킥 규칙 적용 {n_gain}곡"
        )
        if args.reference is not None:
            rate = 2 * n_same / max(n_ref + n_svc, 1)
            line += f" | 실험 노트 {n_ref} 서비스 노트 {n_svc} 같음 {n_same} 일치율 {rate:.4f}"
            if n_missing:
                line += f" (실험 노트 없는 곡 {n_missing})"
                failed = True
        print(line)
    transcriber.close()
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
