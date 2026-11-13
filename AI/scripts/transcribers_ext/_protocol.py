"""별도 환경 채보 스크립트 공용 틀. ssaplash_ai를 import하지 않음.

스크립트는 load(options, device) → (handle, checkpoint, n_params)와
transcribe(handle, wav_path, device, options) → [[시각, 라벨, 세기|None], ...] 두 함수만 만들고
run(load, transcribe)를 부름. 여기서 요청 JSON을 읽고, 모델을 한 번 올리고(load_sec), 곡마다 시간과
GPU 메모리(torch가 있으면 max_memory_allocated, 아니면 null)를 재서 응답 JSON을 씀.
곡 하나가 실패해도 그 곡만 error로 적고 계속 돎.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from collections.abc import Callable
from pathlib import Path

MB = 1024 * 1024

LoadFn = Callable[[dict, str], tuple[object, str, int | None]]
TranscribeFn = Callable[[object, str, str, dict], list]


def _cuda_ready(device: str) -> bool:
    if not device.startswith("cuda"):
        return False
    try:
        import torch

        return bool(torch.cuda.is_available())
    except ImportError:
        return False


def _sync_and_peak(device: str, reset: bool = False) -> float | None:
    if not _cuda_ready(device):
        return None
    import torch

    torch.cuda.synchronize()
    if reset:
        torch.cuda.reset_peak_memory_stats()
        return None
    return torch.cuda.max_memory_allocated() / MB


def run(
    load: LoadFn, transcribe: TranscribeFn, note: str | Callable[[], str | None] | None = None
) -> int:
    """note는 문자열이거나 load 뒤에 평가할 함수(로드 결과에 따라 달라지는 안내용)."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    device = request.get("device", "cpu")
    options = request.get("options") or {}
    response: dict = {
        "load_sec": None,
        "checkpoint": "",
        "n_params": None,
        "songs": [],
        "note": None,
    }

    t0 = time.perf_counter()
    handle, checkpoint, n_params = load(options, device)
    response["load_sec"] = time.perf_counter() - t0
    response["checkpoint"] = checkpoint
    response["n_params"] = n_params
    response["note"] = note() if callable(note) else note

    songs = request.get("songs", [])
    if request.get("warmup") and songs:
        try:
            transcribe(handle, songs[0]["wav_path"], device, options)
        except Exception:
            print("워밍업 실패 (무시):", traceback.format_exc(limit=2), file=sys.stderr)

    for song in songs:
        entry: dict = {
            "song_id": song["song_id"],
            "hits": [],
            "elapsed_sec": None,
            "peak_vram_mb": None,
            "error": None,
        }
        try:
            _sync_and_peak(device, reset=True)
            t1 = time.perf_counter()
            hits = transcribe(handle, song["wav_path"], device, options)
            peak = _sync_and_peak(device)
            entry["elapsed_sec"] = time.perf_counter() - t1
            entry["peak_vram_mb"] = peak
            entry["hits"] = [
                [float(t), label, None if v is None else int(v)] for t, label, v in hits
            ]
        except Exception as exc:
            entry["error"] = f"{type(exc).__name__}: {exc}"[:300]
            print(traceback.format_exc(limit=3), file=sys.stderr)
        response["songs"].append(entry)

    Path(args.response).write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
    return 0


def midi_hits(path: str | Path) -> list:
    """MIDI 파일 → [[시각, 피치, 세기], ...]. pretty_midi가 있으면 쓰고 없으면 mido."""
    try:
        import pretty_midi

        pm = pretty_midi.PrettyMIDI(str(path))
        out = []
        for inst in pm.instruments:
            for n in inst.notes:
                out.append([float(n.start), int(n.pitch), int(n.velocity)])
        return sorted(out)
    except ImportError:
        import mido

        out = []
        t = 0.0
        for msg in mido.MidiFile(str(path)):
            t += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                out.append([t, msg.note, msg.velocity])
        return out
