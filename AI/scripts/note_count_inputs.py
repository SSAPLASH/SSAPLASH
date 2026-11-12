"""노트 수 기준값 측정에 쓸 입력 묶음(zip)을 만드는 스크립트. AI/ 폴더에서 실행.

  uv run python scripts/note_count_inputs.py
  uv run python scripts/note_count_inputs.py --speech-dir <한국어 음성 pcm 폴더> --extra <파일> <파일> ...
  → data/upload/note_count_inputs.zip (GPU 서버 ssaplash/upload/에 올림)

zip 안은 `note_count_inputs/<집합>/<파일>`. `scripts/note_count_measure.py --inputs`에 그대로 넣음.

| 집합 | 내용 |
| --- | --- |
| musdb_mix | MUSDB18-HQ test 50곡 원곡의 가운데 90초. 드럼 있음 |
| musdb_nodrum | 같은 곡 같은 구간의 보컬 + 베이스 + 그 밖의 악기 합. 드럼 없음 |
| speech | --speech-dir의 16kHz 16비트 pcm 발화를 40초씩 이어 붙인 묶음 10개 |
| talk_bgm | 같은 음성 묶음에 musdb_mix 곡을 음성보다 10dB 작게 깐 파일 10개 |
| extra | --extra로 준 파일을 그대로 복사 (말소리가 대부분인 영상, 소음 등) |

- 길이를 90초로 자른 것은 올릴 파일 크기를 줄이려는 것. 기준은 1분당 노트 수라 길이와 무관하게 비교됨
- 서비스에 올라오는 음원이 대부분 손실 압축이라 mp3로 저장함. mp3 쓰기가 안 되는 환경이면 flac
- 파일 이름은 `번호_곡 이름`에서 영문·숫자만 남김. 서버 셸에서 따옴표 문제를 피하려는 것
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

ROOT = "note_count_inputs"
SPEECH_RATE = 16000
OUT_RATE = 44100
SPEECH_SEC = 40
N_SPEECH = 10
BGM_DB = -10.0


def slug(index: int, name: str) -> str:
    text = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")[:40]
    return f"{index:02d}_{text}"


def write_audio(path: Path, audio: np.ndarray, rate: int) -> Path:
    """(샘플, 채널) 배열 저장. mp3가 안 되면 flac. 실제로 쓴 경로를 돌려줌."""
    peak = float(np.abs(audio).max()) if audio.size else 0.0
    if peak > 0.98:
        audio = audio * (0.98 / peak)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        sf.write(str(path.with_suffix(".mp3")), audio, rate, format="MP3")
        return path.with_suffix(".mp3")
    except Exception:
        path.with_suffix(".mp3").unlink(missing_ok=True)
        sf.write(str(path.with_suffix(".flac")), audio, rate, format="FLAC", subtype="PCM_16")
        return path.with_suffix(".flac")


def read_clip(path: Path, clip_sec: float) -> np.ndarray:
    """파일 가운데 clip_sec초를 (샘플, 채널) float32로."""
    info = sf.info(str(path))
    n = min(int(clip_sec * info.samplerate), info.frames)
    start = (info.frames - n) // 2
    audio, _ = sf.read(str(path), start=start, frames=n, dtype="float32", always_2d=True)
    return audio


def speech_bundle(files: list[Path]) -> np.ndarray:
    """pcm 발화를 SPEECH_SEC초가 될 때까지 이어 붙여 44.1kHz 스테레오로."""
    need, parts, total = SPEECH_SEC * SPEECH_RATE, [], 0
    for f in files:
        x = np.fromfile(f, dtype="<i2").astype(np.float32) / 32768.0
        parts.append(x)
        total += len(x)
        if total >= need:
            break
    mono = np.concatenate(parts)[:need]
    mono = soxr.resample(mono, SPEECH_RATE, OUT_RATE).astype(np.float32)
    return np.stack([mono, mono], axis=1)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-9)


def build(args: argparse.Namespace, work: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    songs = sorted(p for p in Path(args.musdb).iterdir() if (p / "mixture.wav").is_file())
    if args.limit:
        songs = songs[: args.limit]
    mix_clips = []
    for i, song in enumerate(songs, 1):
        name = slug(i, song.name)
        mix = read_clip(song / "mixture.wav", args.clip_sec)
        nodrum = sum(
            read_clip(song / f"{stem}.wav", args.clip_sec) for stem in ("vocals", "bass", "other")
        )
        write_audio(work / ROOT / "musdb_mix" / name, mix, OUT_RATE)
        write_audio(work / ROOT / "musdb_nodrum" / name, nodrum, OUT_RATE)
        mix_clips.append((name, mix))
    counts["musdb_mix"] = counts["musdb_nodrum"] = len(songs)

    if args.speech_dir:
        pcm = sorted(Path(args.speech_dir).rglob("*.pcm"))
        step = max(1, len(pcm) // N_SPEECH)
        n = 0
        for b in range(N_SPEECH):
            files = pcm[b * step : (b + 1) * step]
            if not files or not mix_clips:
                break
            speech = speech_bundle(files)
            write_audio(work / ROOT / "speech" / f"{b + 1:02d}_speech", speech, OUT_RATE)
            song_name, music = mix_clips[(b * 5) % len(mix_clips)]
            music = music[: len(speech)]
            gain = rms(speech) / rms(music) * 10 ** (BGM_DB / 20)
            mixed = speech[: len(music)] + music * gain
            write_audio(
                work / ROOT / "talk_bgm" / f"{b + 1:02d}_speech_{song_name}", mixed, OUT_RATE
            )
            n += 1
        counts["speech"] = counts["talk_bgm"] = n

    for i, extra in enumerate(args.extra or [], 1):
        src = Path(extra)
        dst = work / ROOT / "extra" / f"{slug(i, src.stem)}{src.suffix.lower()}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
    if args.extra:
        counts["extra"] = len(args.extra)
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="노트 수 기준값 측정용 입력 묶음 만들기")
    parser.add_argument("--musdb", default="data/musdb18hq/test", help="MUSDB18-HQ test 폴더")
    parser.add_argument("--out", default="data/upload/note_count_inputs.zip")
    parser.add_argument("--clip-sec", type=float, default=90.0)
    parser.add_argument("--speech-dir", help="16kHz 16비트 모노 pcm 발화 폴더 (예: KsponSpeech)")
    parser.add_argument("--extra", nargs="*", help="그대로 넣을 파일들")
    parser.add_argument("--limit", type=int, help="MUSDB 곡 수 상한(동작 확인용)")
    args = parser.parse_args(argv)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        counts = build(args, Path(tmp))
        files = sorted(p for p in (Path(tmp) / ROOT).rglob("*") if p.is_file())
        # 이미 압축된 음원이라 다시 압축하지 않음
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
            for f in files:
                z.write(f, f.relative_to(tmp).as_posix())
    print(f"{out} {out.stat().st_size / 2**20:.0f} MiB, 파일 {len(files)}개, 집합별 {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
