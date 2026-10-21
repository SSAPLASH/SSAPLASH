"""평가 데이터셋 로더.

yaml 설정의 kind 값으로 로더 선택. runner는 load_dataset만 호출.
"""

from __future__ import annotations

from pathlib import Path

from ssaplash_ai.bench.datasets.base import (
    SAMPLE_RATE,
    BaseDataset,
    CheckReport,
    DatasetConfig,
    SongItem,
    read_audio,
    write_audio,
)
from ssaplash_ai.bench.datasets.gmd import GmdDataset
from ssaplash_ai.bench.datasets.mdb import MdbDataset
from ssaplash_ai.bench.datasets.musdb import MusdbDataset
from ssaplash_ai.bench.datasets.pads import (
    COARSE,
    DROP,
    FIVE_GROUPS,
    HITS_DTYPE,
    PADS,
    PRED_LABELS,
    clip_hits,
    count_by_pad,
    has_coarse,
    make_hits,
    to_five_groups,
    validate_hits,
    validate_pred_hits,
)
from ssaplash_ai.bench.datasets.synth import SynthDataset

LOADERS: dict[str, type[BaseDataset]] = {
    MusdbDataset.kind: MusdbDataset,
    SynthDataset.kind: SynthDataset,
    GmdDataset.kind: GmdDataset,
    MdbDataset.kind: MdbDataset,
}


def load_dataset(config: DatasetConfig | str | Path) -> BaseDataset:
    """yaml 경로나 DatasetConfig를 받아 kind에 맞는 로더 생성."""
    if not isinstance(config, DatasetConfig):
        config = DatasetConfig.from_yaml(config)
    try:
        loader = LOADERS[config.kind]
    except KeyError as e:
        raise ValueError(f"모르는 데이터셋 종류: {config.kind} (가능: {sorted(LOADERS)})") from e
    return loader(config)


__all__ = [
    "COARSE",
    "DROP",
    "FIVE_GROUPS",
    "HITS_DTYPE",
    "PADS",
    "PRED_LABELS",
    "SAMPLE_RATE",
    "BaseDataset",
    "CheckReport",
    "DatasetConfig",
    "GmdDataset",
    "MdbDataset",
    "MusdbDataset",
    "SongItem",
    "SynthDataset",
    "clip_hits",
    "count_by_pad",
    "has_coarse",
    "load_dataset",
    "make_hits",
    "read_audio",
    "to_five_groups",
    "validate_hits",
    "validate_pred_hits",
    "write_audio",
]
