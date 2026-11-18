"""Songsterr 탭을 원곡에 맞춘 공용 곡 로더 (data/songsterr).

곡 폴더마다 `final/`(빠르기가 바뀌는 곡은 `final_tempomap/`)에 원곡 `mix.flac`, 서비스 분리 모델로 뽑은 드럼
`drums.flac`, 드럼리스 MR `drumless.flac`, 정답 채보 `chart.json`이 있음. 셋 다 같은 시간축.

- drums_true는 분리 드럼이다. 녹음된 드럼 단독 트랙이 없어서, 서비스와 같은 분리 결과를 정답 드럼 자리에 둠
- mixture는 mix.flac을 읽지 않고 drums + drumless로 만듦(디코딩 시간 절약). 분리 모델이 원곡 − 드럼으로 MR을
  만들어서 원곡과 거의 같음
- hits_true는 chart.json 노트. 하이햇 페달은 HIHAT_PEDAL로 둠
- 정답은 사람이 적은 탭이라 실제 연주와 다른 노트가 있을 수 있음
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.base import BaseDataset, SongItem, match_length
from ssaplash_ai.bench.datasets.pads import clip_hits, make_hits


def final_dir(song_dir: Path) -> Path:
    tm = song_dir / "final_tempomap"
    return tm if (tm / "chart.json").is_file() else song_dir / "final"


class SongsterrDataset(BaseDataset):
    kind = "songsterr"

    def song_ids(self) -> list[str]:
        if self.config.songs:
            return list(self.config.songs)
        root = Path(self.config.root)
        return sorted(p.name for p in root.iterdir() if (final_dir(p) / "chart.json").is_file())

    def required_files(self, song_id: str) -> list[Path]:
        f = final_dir(Path(self.config.root) / song_id)
        return [f / "drums.flac", f / "drumless.flac", f / "chart.json"]

    def hits_of(self, song_id: str) -> tuple[np.ndarray, int]:
        chart = json.loads(self.required_files(song_id)[2].read_text(encoding="utf-8"))
        notes = chart["charts"][0]["notes"]
        hits, dropped = make_hits(
            (n["timeMs"] / 1000.0 for n in notes),
            (n["pad"] for n in notes),
            (n.get("velocityHint") for n in notes),
            {p: p for p in {n["pad"] for n in notes}},
        )
        if self.config.clip is not None:
            hits = clip_hits(hits, *self.config.clip)
        return hits, dropped

    def load(self, song_id: str) -> SongItem:
        drums_path, accomp_path, _ = self.required_files(song_id)
        drums, accomp = match_length(self._read(drums_path), self._read(accomp_path))
        hits, dropped = self.hits_of(song_id)
        return SongItem(
            dataset=self.name,
            song_id=song_id,
            sample_rate=self.config.sample_rate,
            mixture=drums + accomp,
            drums_true=drums,
            accomp_true=accomp,
            clip=self.config.clip,
            onsets_true=np.unique(hits["time_sec"]),
            hits_true=hits,
            hits_dropped=dropped,
        )
