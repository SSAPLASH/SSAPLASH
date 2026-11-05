"""R2 비슷한 곡의 유사도(BE `SimilarityEngine`)를 numpy로 포팅한 것. 채보 전체 쌍의 유사도 행렬을 한 번에 만든다.

서비스와 같은 계수: 리듬 격자 0.35, 패드 구성 0.20, 전환 0.15, 밀도 0.15, 템포 0.15.
오프라인과 서비스의 차이(문서화된 근사):
- 박자표가 입력에 없어 분자가 다를 때의 감점(×0.5)은 적용하지 않는다(모두 4/4로 본다).
- 최소 유사도 0.5 미만 제외는 적용하지 않는다(순위만 필요하다).
- 곡 메타데이터 보조(15%)는 쓰지 않는다. 채보 유사도만 평가에 쓴다.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ssaplash_ai.recommend.simulate import GROUPS

W_RHYTHM, W_PADS, W_TRANSITIONS, W_DENSITY, W_TEMPO = 0.35, 0.20, 0.15, 0.15, 0.15
GROUP_WEIGHT = {"KICK": 0.30, "SNARE": 0.30, "HAT": 0.25, "CYMBAL": 0.10, "TOM": 0.05}
TEMPO_SPAN = 0.5
DIVISIONS = 12


def _normalized(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    norms = np.linalg.norm(matrix, axis=1)
    safe = np.where(norms == 0, 1.0, norms)
    return matrix / safe[:, None], norms > 0


def _cosine(matrix: np.ndarray) -> np.ndarray:
    unit, nonzero = _normalized(matrix)
    sim = unit @ unit.T
    sim[~nonzero, :] = 0.0
    sim[:, ~nonzero] = 0.0
    return np.clip(sim, 0.0, 1.0)


def _vocabulary_matrix(maps: list[dict[str, float]]) -> np.ndarray:
    keys = sorted({k for m in maps for k in m})
    index = {k: i for i, k in enumerate(keys)}
    out = np.zeros((len(maps), max(1, len(keys))))
    for row, m in enumerate(maps):
        for key, value in m.items():
            out[row, index[key]] = value
    return out


def _closeness(values: np.ndarray, span: float) -> np.ndarray:
    log = np.log2(np.maximum(values, 1e-9))
    return np.clip(1.0 - np.minimum(1.0, np.abs(log[:, None] - log[None, :]) / span), 0.0, 1.0)


class ChartSimilarity:
    """채보 쌍의 유사도(0~1) 행렬 `sim[i, j]`와, 채보 → 곡 단위 점수 행렬 `to_song[i, s]`."""

    def __init__(self, charts: pd.DataFrame, songs: pd.DataFrame):
        """`charts`는 `Dataset.chart_features`, `songs`는 `Dataset.songs`."""
        self.chart_ids = charts["chart_id"].to_numpy(dtype="int64")
        self.chart_index = {int(c): i for i, c in enumerate(self.chart_ids)}
        self.song_ids = np.sort(songs["song_id"].to_numpy(dtype="int64"))
        self.song_index = {int(s): i for i, s in enumerate(self.song_ids)}
        n = len(charts)

        grids = [g.get("groups") for g in charts["rhythm_grid"]]
        self.valid = np.array([g is not None for g in grids])  # 격자가 있는 채보만 비교할 수 있다
        bpm = songs.set_index("song_id")["bpm"]
        tempo = np.array([float(bpm[int(s)]) for s in charts["song_id"]])
        density = charts["avg_notes_per_sec"].to_numpy(dtype="float64")

        rhythm_num = np.zeros((n, n))
        rhythm_den = np.zeros((n, n))
        for group in GROUPS:
            bins = np.array(
                [(g or {}).get(group, [0.0] * DIVISIONS) for g in grids], dtype="float64"
            )
            nonempty = bins.sum(axis=1) > 0
            weight = GROUP_WEIGHT[group]
            both = nonempty[:, None] & nonempty[None, :]
            either = nonempty[:, None] | nonempty[None, :]
            rhythm_num += weight * _cosine(bins) * both
            rhythm_den += weight * either
        rhythm = np.divide(rhythm_num, rhythm_den, out=np.zeros((n, n)), where=rhythm_den > 0)

        pads = _cosine(_vocabulary_matrix([dict(p) for p in charts["pad_ratio"]]))
        transitions = _cosine(_vocabulary_matrix([dict(t) for t in charts["transition_ratio"]]))
        sim = (
            W_RHYTHM * rhythm
            + W_PADS * pads
            + W_TRANSITIONS * transitions
            + W_DENSITY * _closeness(density, 1.0)
            + W_TEMPO * _closeness(tempo, TEMPO_SPAN)
        )
        sim[~self.valid, :] = 0.0
        sim[:, ~self.valid] = 0.0
        self.sim = np.clip(sim, 0.0, 1.0)

        self.density = density
        self.difficulty = list(charts["difficulty"])
        self.song_of_chart = np.array([self.song_index[int(s)] for s in charts["song_id"]])
        self.to_song = self._to_song()

    def _to_song(self) -> np.ndarray:
        """채보 i에서 곡 s로: s의 비교 가능한 채보 중 i와 같은 난이도(없으면 밀도가 가장 가까운 것) 하나와의 유사도.

        서비스가 후보 곡마다 채보 하나를 고르는 규칙과 같다. 곡 자신(같은 곡의 채보)은 1로 둔다(평가에서 `exclude`로 뺀다).
        """
        n, s = len(self.chart_ids), len(self.song_ids)
        by_song: dict[int, list[int]] = {}
        for chart, song in enumerate(self.song_of_chart):
            if self.valid[chart]:
                by_song.setdefault(int(song), []).append(chart)
        out = np.zeros((n, s))
        for song, members in by_song.items():
            for chart in range(n):
                if not self.valid[chart]:
                    continue
                if self.song_of_chart[chart] == song:
                    out[chart, song] = 1.0
                    continue
                same = [m for m in members if self.difficulty[m] == self.difficulty[chart]]
                if same:
                    chosen = same[0]  # (곡, 난이도)는 유일하다
                else:
                    chosen = min(
                        members,
                        key=lambda m, c=chart: (
                            abs(np.log(max(self.density[m], 1e-9) / max(self.density[c], 1e-9))),
                            self.chart_ids[m],
                        ),
                    )
                out[chart, song] = self.sim[chart, chosen]
        return out
