"""합성 데이터 생성기(설계 문서 부록 B.4).

실데이터가 충분해지기 전에 파이프라인과 평가 하니스가 맞게 돌아가는지, 그리고 모델이 **심어 둔 취향**을 되찾는지
확인하는 용도다. **여기서 나온 점수는 모델의 실제 성능이 아니다.** 하니스 검증과 회귀 방지에만 쓴다.

- 곡: 장르별 원형(패드 구성·리듬 격자·밀도·BPM)에 무작위를 더한 가상 곡. 앞의 3곡은 연습 패턴을 흉내 낸 것이다(실제 MIDI 특징이 아님).
- 사용자: 숨은 실력(감당하는 노트 밀도)과 장르 취향을 가진다.
- 연주: 취향·실력 적합도·인기에 따라 시간순으로 뽑는다. 일부 곡은 시간선의 마지막 20% 구간에서야 나온다(새 곡).
- 시드가 같으면 모든 값이 같다. 사용자·곡 정보는 모두 가짜다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from ssaplash_ai.recommend import schema as S

PAD_NAMES = (
    "KICK",
    "SNARE",
    "HIHAT",
    "HIHAT_PEDAL",
    "CRASH",
    "RIDE",
    "SMALL_TOM",
    "MID_TOM",
    "FLOOR_TOM",
)
GROUPS = ("KICK", "SNARE", "HAT", "CYMBAL", "TOM")
DIVISIONS = 12
DIFFICULTY_SCALE = {"EASY": 0.55, "NORMAL": 1.0, "HARD": 1.45}
CONTENT_GENRES = ("ROCK", "POP", "JAZZ", "FUNK", "METAL", "ELECTRONIC")

# 장르 원형. grid는 묶음별 12칸 가중치(칸 번호: 값). 비어 있는 묶음은 그 장르에 노트가 거의 없다는 뜻이다.
PROTOTYPES: dict[str, dict] = {
    "ROCK": {
        "bpm": (100, 150),
        "density": (2.2, 4.0),
        "mood": ("ENERGETIC", "UPLIFTING"),
        "energy": (3, 5),
        "drum": ("EIGHT_BEAT",),
        "language": ("EN", "KO"),
        "pads": {
            "KICK": 0.25,
            "SNARE": 0.22,
            "HIHAT": 0.38,
            "CRASH": 0.05,
            "SMALL_TOM": 0.04,
            "FLOOR_TOM": 0.03,
            "RIDE": 0.03,
        },
        "grid": {
            "KICK": {0: 3, 6: 1},
            "SNARE": {0: 2},
            "HAT": {0: 2, 6: 2},
            "CYMBAL": {0: 1},
            "TOM": {0: 1, 3: 1},
        },
    },
    "POP": {
        "bpm": (90, 130),
        "density": (1.8, 3.4),
        "mood": ("UPLIFTING", "SENTIMENTAL"),
        "energy": (2, 4),
        "drum": ("EIGHT_BEAT", "HALF_TIME"),
        "language": ("KO", "EN"),
        "pads": {
            "KICK": 0.26,
            "SNARE": 0.22,
            "HIHAT": 0.42,
            "CRASH": 0.04,
            "RIDE": 0.03,
            "SMALL_TOM": 0.03,
        },
        "grid": {
            "KICK": {0: 3, 6: 1},
            "SNARE": {0: 2},
            "HAT": {0: 2, 6: 3},
            "CYMBAL": {0: 1},
            "TOM": {0: 1},
        },
    },
    "JAZZ": {
        "bpm": (110, 200),
        "density": (2.0, 4.5),
        "mood": ("CALM", "SENTIMENTAL"),
        "energy": (1, 3),
        "drum": ("SHUFFLE",),
        "language": ("INSTRUMENTAL", "EN"),
        "pads": {
            "RIDE": 0.42,
            "HIHAT_PEDAL": 0.12,
            "SNARE": 0.2,
            "KICK": 0.14,
            "SMALL_TOM": 0.06,
            "FLOOR_TOM": 0.06,
        },
        "grid": {
            "KICK": {0: 2, 8: 1},
            "SNARE": {4: 2, 8: 2, 0: 1},
            "HAT": {0: 2},
            "CYMBAL": {0: 3, 8: 3},
            "TOM": {4: 1, 8: 1},
        },
    },
    "FUNK": {
        "bpm": (95, 125),
        "density": (3.2, 5.8),
        "mood": ("ENERGETIC", "UPLIFTING"),
        "energy": (3, 5),
        "drum": ("SIXTEEN_BEAT", "SYNCOPATED"),
        "language": ("EN", "INSTRUMENTAL"),
        "pads": {
            "HIHAT": 0.45,
            "KICK": 0.22,
            "SNARE": 0.24,
            "CRASH": 0.03,
            "SMALL_TOM": 0.03,
            "HIHAT_PEDAL": 0.03,
        },
        "grid": {
            "KICK": {0: 3, 9: 2, 6: 1},
            "SNARE": {0: 2, 3: 1, 9: 1},
            "HAT": {0: 2, 3: 2, 6: 2, 9: 2},
            "CYMBAL": {0: 1},
            "TOM": {0: 1},
        },
    },
    "METAL": {
        "bpm": (130, 200),
        "density": (4.8, 8.5),
        "mood": ("DARK", "ENERGETIC"),
        "energy": (4, 5),
        "drum": ("DOUBLE_KICK", "FILL_HEAVY"),
        "language": ("EN", "JA"),
        "pads": {
            "KICK": 0.38,
            "SNARE": 0.18,
            "CRASH": 0.1,
            "RIDE": 0.1,
            "HIHAT": 0.1,
            "SMALL_TOM": 0.05,
            "MID_TOM": 0.05,
            "FLOOR_TOM": 0.04,
        },
        "grid": {
            "KICK": {0: 2, 3: 2, 6: 2, 9: 2},
            "SNARE": {0: 3},
            "HAT": {0: 1},
            "CYMBAL": {0: 2, 6: 1},
            "TOM": {0: 1, 3: 1, 6: 1, 9: 1},
        },
    },
    "ELECTRONIC": {
        "bpm": (118, 150),
        "density": (2.4, 4.4),
        "mood": ("ENERGETIC", "UPLIFTING"),
        "energy": (3, 5),
        "drum": ("FOUR_ON_FLOOR",),
        "language": ("INSTRUMENTAL", "EN"),
        "pads": {"KICK": 0.34, "HIHAT": 0.34, "SNARE": 0.18, "CRASH": 0.08, "HIHAT_PEDAL": 0.06},
        "grid": {"KICK": {0: 4}, "SNARE": {0: 2}, "HAT": {6: 4}, "CYMBAL": {0: 1}, "TOM": {}},
    },
}
# 연습 패턴을 흉내 낸 원형(앞의 3곡). 실제 MIDI에서 계산한 값이 아니다.
PRACTICE_SONGS = (
    {
        "bpm": 100,
        "density": 1.6,
        "pads": {"KICK": 0.25, "SNARE": 0.25, "HIHAT": 0.5},
        "drum": ("EIGHT_BEAT",),
        "grid": {"KICK": {0: 2}, "SNARE": {0: 2}, "HAT": {0: 2, 6: 2}, "CYMBAL": {}, "TOM": {}},
    },
    {
        "bpm": 100,
        "density": 2.2,
        "pads": {"KICK": 0.23, "SNARE": 0.22, "HIHAT": 0.45, "SMALL_TOM": 0.05, "FLOOR_TOM": 0.05},
        "drum": ("EIGHT_BEAT", "FILL_HEAVY"),
        "grid": {
            "KICK": {0: 2},
            "SNARE": {0: 2},
            "HAT": {0: 2, 6: 2},
            "CYMBAL": {},
            "TOM": {0: 1, 3: 1},
        },
    },
    {
        "bpm": 100,
        "density": 2.8,
        "pads": {"KICK": 0.2, "SNARE": 0.2, "RIDE": 0.6},
        "drum": ("SIXTEEN_BEAT",),
        "grid": {
            "KICK": {0: 2},
            "SNARE": {0: 2},
            "HAT": {},
            "CYMBAL": {0: 2, 3: 2, 6: 2, 9: 2},
            "TOM": {},
        },
    },
)


@dataclass(frozen=True)
class SimConfig:
    """생성 설정. 모든 값에 기본값이 있고, 같은 설정이면 같은 데이터가 나온다."""

    seed: int = 0
    n_songs: int = 300
    n_users: int = 2000
    days: int = 60
    mean_plays: float = 25.0
    start: str = "2026-09-01T00:00:00Z"
    new_song_fraction: float = 0.1  # 연주 시각 분포의 마지막 20% 구간에서야 나오는 새 곡 비율
    # 새 곡이 열리는 시점: 전체 연주 시각 분포의 분위수 범위. 시간순 분할(기본 80% 지점)보다 뒤라서 새 곡은 항상 cold가 된다
    new_song_release: tuple[float, float] = (0.8, 0.95)
    repeat_probability: float = 0.12  # 이미 친 곡을 다시 칠 확률
    skill_median: float = 3.0  # 사용자가 감당하는 노트 밀도의 중앙값(노트/초)
    preference_strength: float = 1.0  # 장르 취향이 곡 선택에 미치는 정도
    fit_strength: float = 1.0  # 실력 적합도가 곡 선택에 미치는 정도


@dataclass(frozen=True)
class Truth:
    """생성에 쓴 숨은 값. 하니스가 "심어 둔 것을 되찾는가"를 확인하는 데만 쓰며 파일로 쓰지 않는다."""

    user_skill: dict[str, float]
    user_affinity: pd.DataFrame  # 행: user_key, 열: 장르
    song_genre: dict[int, str]
    new_song_release: dict[int, pd.Timestamp]
    chart_density: dict[int, float]


@dataclass(frozen=True)
class SyntheticData:
    """스키마 파일과 같은 모양(JSON 열은 문자열)의 표들. `write`로 CSV 폴더를 만든다."""

    config: SimConfig
    users: pd.DataFrame
    songs: pd.DataFrame
    chart_features: pd.DataFrame
    interactions: pd.DataFrame
    song_meta: pd.DataFrame
    weak_summary: pd.DataFrame
    truth: Truth = field(repr=False)

    def write(self, directory: str | Path) -> Path:
        root = Path(directory)
        root.mkdir(parents=True, exist_ok=True)
        for name, frame in (
            ("users", self.users),
            ("songs", self.songs),
            ("chart_features", self.chart_features),
            ("interactions", self.interactions),
            ("song_meta", self.song_meta),
            ("weak_summary", self.weak_summary),
        ):
            frame.to_csv(root / S.FILES[name].filename, index=False, encoding="utf-8")
        return root


# ---------------------------------------------------------------- 곡


def _bins(weights: dict[int, float]) -> np.ndarray:
    out = np.zeros(DIVISIONS)
    for index, weight in weights.items():
        out[index] = weight
    return out


def _grid_document(template: dict[str, dict[int, float]], rng: np.random.Generator) -> dict:
    groups = {}
    for name in GROUPS:
        base = _bins(template.get(name, {}))
        if base.sum() == 0:
            groups[name] = [0.0] * DIVISIONS
            continue
        noisy = base + rng.uniform(0, 0.25, DIVISIONS) * base.max()
        groups[name] = [round(float(v), 4) for v in noisy / noisy.sum()]
    return {"divisions": DIVISIONS, "groups": groups}


def _pad_ratio(base: dict[str, float], rng: np.random.Generator) -> dict[str, float]:
    names = sorted(base)
    weights = rng.dirichlet(np.array([base[n] for n in names]) * 60)
    return {n: round(float(w), 4) for n, w in zip(names, weights, strict=True) if w >= 0.0005}


def _transitions(pads: dict[str, float]) -> dict[str, float]:
    pairs = {f"{a}>{b}": pa * pb for a, pa in pads.items() for b, pb in pads.items() if a != b}
    total = sum(pairs.values()) or 1.0
    top = sorted(pairs.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
    return {key: round(value / total, 4) for key, value in top}


def _song_level(density: float, peak: int) -> str:
    # BE의 곡 난이도 규칙(song-level-1)과 같은 기준
    if density >= 7 or peak >= 16:
        return "ADVANCED"
    if density >= 5 or peak >= 12:
        return "INTERMEDIATE"
    return "BEGINNER"


def _make_songs(cfg: SimConfig, rng: np.random.Generator):
    songs, charts, meta = [], [], []
    genre_of: dict[int, str] = {}
    density_of: dict[int, float] = {}
    chart_id = 0
    for song_id in range(1, cfg.n_songs + 1):
        practice = song_id <= len(PRACTICE_SONGS)
        if practice:
            proto = PRACTICE_SONGS[song_id - 1]
            genre, bpm = "PRACTICE", float(proto["bpm"])
            base_density = float(proto["density"]) * rng.uniform(0.95, 1.05)
            pads_base, grid_template = proto["pads"], proto["grid"]
            drum, mood, energy, language = proto["drum"], (), None, ""
        else:
            genre = str(rng.choice(CONTENT_GENRES))
            proto = PROTOTYPES[genre]
            bpm = float(round(rng.uniform(*proto["bpm"]), 1))
            base_density = float(rng.uniform(*proto["density"]))
            pads_base, grid_template = proto["pads"], proto["grid"]
            drum = proto["drum"]
            mood = tuple(rng.choice(proto["mood"], size=int(rng.integers(1, 3)), replace=False))
            energy = int(rng.integers(proto["energy"][0], proto["energy"][1] + 1))
            language = str(rng.choice(proto["language"]))
        genre_of[song_id] = genre
        duration_ms = int(rng.integers(90, 241)) * 1000
        variable_tempo = (not practice) and rng.random() < 0.05
        present = ["NORMAL"]
        if practice or rng.random() >= 0.1:
            present.insert(0, "EASY")
        if practice or rng.random() >= 0.1:
            present.append("HARD")
        song_pads = _pad_ratio(pads_base, rng)
        grid = _grid_document(grid_template, rng)
        hard_density, hard_peak = base_density, 0
        for difficulty in present:
            chart_id += 1
            density = round(
                base_density * DIFFICULTY_SCALE[difficulty] * rng.uniform(0.95, 1.05), 3
            )
            peak = int(round(density * 2 * rng.uniform(1.2, 1.8)))
            density_of[chart_id] = density
            if difficulty == present[-1]:
                hard_density, hard_peak = density, peak
            pads = {k: round(max(0.0, v * rng.uniform(0.9, 1.1)), 4) for k, v in song_pads.items()}
            charts.append(
                {
                    "chart_id": chart_id,
                    "song_id": song_id,
                    "difficulty": difficulty,
                    "avg_notes_per_sec": density,
                    "peak_notes_2s": peak,
                    "pad_ratio": json.dumps(pads),
                    "transition_ratio": json.dumps(_transitions(pads)),
                    "rhythm_grid": json.dumps(
                        {"excluded": "VARIABLE_TEMPO"} if variable_tempo else grid
                    ),
                }
            )
        songs.append(
            {
                "song_id": song_id,
                "bpm": bpm,
                "duration_ms": duration_ms,
                "song_level": _song_level(hard_density, hard_peak),
                "public": True,
            }
        )
        meta.append(
            {
                "song_id": song_id,
                "genre": genre,
                "sub_genres": "",
                "mood": ";".join(mood),
                "energy": "" if energy is None else energy,
                "language": language,
                "drum_style": ";".join(drum),
            }
        )
    return pd.DataFrame(songs), pd.DataFrame(charts), pd.DataFrame(meta), genre_of, density_of


# ---------------------------------------------------------------- 사용자와 연주


def _fit(density: np.ndarray, skill: float) -> np.ndarray:
    """실력에 맞는 정도(0이 가장 좋음). 기준 밀도의 약 1.15배를 가장 알맞게 본다(R1 규칙과 같은 값)."""
    return -((((np.log(np.maximum(density, 1e-6) / skill)) - np.log(1.15)) / 0.45) ** 2)


def generate(cfg: SimConfig | None = None) -> SyntheticData:
    cfg = cfg or SimConfig()
    if cfg.n_songs < len(PRACTICE_SONGS) + 1 or cfg.n_users < 1:
        raise ValueError("곡은 연습 패턴(3개)보다 많아야 하고 사용자는 1명 이상이어야 합니다.")
    rng = np.random.default_rng(cfg.seed)
    songs, charts, meta, genre_of, density_of = _make_songs(cfg, rng)
    song_ids = songs["song_id"].to_numpy()
    n_songs = len(song_ids)
    genres = list(CONTENT_GENRES) + ["PRACTICE"]
    genre_index = np.array([genres.index(genre_of[int(s)]) for s in song_ids])
    popularity = np.log(rng.lognormal(0.0, 0.8, n_songs))

    # 곡별 채보 밀도 표(없는 난이도는 NaN)와 채보 id 표
    diffs = list(DIFFICULTY_SCALE)
    density_table = np.full((n_songs, 3), np.nan)
    chart_table = np.zeros((n_songs, 3), dtype="int64")
    row_of = {int(s): i for i, s in enumerate(song_ids)}
    for row in charts.itertuples():
        i, j = row_of[row.song_id], diffs.index(row.difficulty)
        density_table[i, j] = row.avg_notes_per_sec
        chart_table[i, j] = row.chart_id

    pads_of = {
        int(c): json.loads(p) for c, p in zip(charts["chart_id"], charts["pad_ratio"], strict=True)
    }

    # 새 곡: 시간선의 마지막 구간에서야 열린다(연습 패턴 3곡은 처음부터 있다)
    start = pd.Timestamp(cfg.start)
    n_new = int(round(cfg.new_song_fraction * (n_songs - len(PRACTICE_SONGS))))
    new_rows = (
        rng.choice(np.arange(len(PRACTICE_SONGS), n_songs), size=n_new, replace=False)
        if n_new
        else np.array([], dtype=int)
    )
    # 연주 시각을 먼저 모두 뽑고, 새 곡이 열리는 시점을 그 분포의 분위수로 정한다(분할 기준과 같은 척도)
    plans = []
    for _ in range(cfg.n_users):
        n_plays = max(3, int(rng.poisson(cfg.mean_plays)))
        join = rng.uniform(0.0, 0.7)
        plans.append(np.sort(rng.uniform(join, 1.0, n_plays)))
    all_times = np.concatenate(plans)
    release = np.zeros(n_songs)
    release[new_rows] = np.quantile(all_times, rng.uniform(*cfg.new_song_release, size=n_new))

    users, interactions, weak_rows = [], [], []
    skills: dict[str, float] = {}
    affinities: list[np.ndarray] = []
    keys: list[str] = []
    for u in range(cfg.n_users):
        key = f"synth-user-{u:06d}"
        keys.append(key)
        skill = float(np.clip(np.exp(rng.normal(np.log(cfg.skill_median), 0.45)), 1.0, 9.0))
        skills[key] = skill
        aff = rng.dirichlet(np.full(len(CONTENT_GENRES), 0.4))
        full = np.append(aff, 0.3 if skill < 2.5 else 0.05)  # 연습 패턴은 초보가 더 친다
        affinities.append(full[: len(CONTENT_GENRES)])
        users.append(
            {"user_key": key, "consent_recommendation": True, "consent_version": "synthetic"}
        )

        # 없는 난이도는 밀도를 아주 작게 둬서 적합도가 매우 낮게 나온다(고르지 않음)
        fit_table = _fit(np.nan_to_num(density_table, nan=1e-6), skill)
        logit = (
            cfg.preference_strength * np.log(full[genre_index] + 0.02)
            + cfg.fit_strength * fit_table.max(axis=1)
            + 0.5 * popularity
        )
        base_prob = np.exp(logit - logit.max())

        times = plans[u]
        history: list[tuple[int, int]] = []
        struggled: dict[str, list[float]] = {}
        for t in times:
            if history and rng.random() < cfg.repeat_probability:
                i, j = history[int(rng.integers(len(history)))]
            else:
                prob = np.where(release <= t, base_prob, 0.0)  # 새 곡은 열린 뒤에만 나온다
                i = int(rng.choice(n_songs, p=prob / prob.sum()))
                fits = fit_table[i]
                weights = np.exp((fits - fits.max()) / 0.5)
                j = int(rng.choice(3, p=weights / weights.sum()))
            history.append((i, j))
            density = float(density_table[i, j])
            over = max(0.0, density / skill - 1.0)
            accuracy = float(np.clip(rng.normal(92 - 45 * over, 4 + 6 * over), 20, 100))
            played = start + pd.Timedelta(days=cfg.days * float(t))
            interactions.append(
                {
                    "user_key": key,
                    "song_id": int(song_ids[i]),
                    "chart_id": int(chart_table[i, j]),
                    "played_at": played.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                    "accuracy": round(accuracy, 2),
                    "completed": bool(accuracy >= 50 and rng.random() >= 0.03),
                    "mode": "SHEET" if rng.random() < 0.1 else "RHYTHM",
                }
            )
            if accuracy < 75:
                for pad, share in pads_of[int(chart_table[i, j])].items():
                    struggled.setdefault(pad, []).append(share * (75 - accuracy) / 75)
        for pad, severities in sorted(struggled.items(), key=lambda kv: (-sum(kv[1]), kv[0]))[:2]:
            weak_rows.append(
                {
                    "user_key": key,
                    "pattern": "PAD_LATE",
                    "pad": pad,
                    "count": len(severities),
                    "avg_severity": round(float(min(1.0, np.mean(severities) * 4)), 4),
                }
            )

    interactions_df = (
        pd.DataFrame(interactions).sort_values("played_at", kind="stable").reset_index(drop=True)
    )
    release_ts = {
        int(song_ids[i]): start + pd.Timedelta(days=cfg.days * float(release[i])) for i in new_rows
    }
    truth = Truth(
        user_skill=skills,
        user_affinity=pd.DataFrame(np.vstack(affinities), index=keys, columns=list(CONTENT_GENRES)),
        song_genre=genre_of,
        new_song_release=release_ts,
        chart_density=density_of,
    )
    weak = pd.DataFrame(weak_rows, columns=["user_key", "pattern", "pad", "count", "avg_severity"])
    return SyntheticData(
        cfg, pd.DataFrame(users), songs, charts, interactions_df, meta, weak, truth
    )
