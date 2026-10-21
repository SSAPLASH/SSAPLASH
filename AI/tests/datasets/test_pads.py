"""패드 어휘·타격 표 테스트 (설계 3-2절, 인수 조건 4)."""

from __future__ import annotations

import numpy as np
import pytest

from ssaplash_ai.bench.datasets import (
    DROP,
    FIVE_GROUPS,
    HITS_DTYPE,
    PADS,
    clip_hits,
    count_by_pad,
    make_hits,
    to_five_groups,
    validate_hits,
)

TABLE = {36: "KICK", 38: "SNARE", 42: "HIHAT", 49: "CRASH", 56: DROP}


def test_pads_vocabulary():
    assert len(PADS) == 8
    assert set(FIVE_GROUPS) == set(PADS)
    assert set(FIVE_GROUPS.values()) == {"kick", "snare", "hihat", "tom", "cymbal"}


def test_make_hits_sorts_and_drops():
    hits, dropped = make_hits([1.0, 0.5, 0.75, 0.6], [38, 36, 56, 42], [100, 90, 80, None], TABLE)
    assert hits.dtype == HITS_DTYPE
    assert dropped == 1
    assert hits["time_sec"].tolist() == [0.5, 0.6, 1.0]
    assert hits["pad"].tolist() == ["KICK", "HIHAT", "SNARE"]
    assert hits["velocity"].tolist() == [90, -1, 100]
    validate_hits(hits)


def test_make_hits_unknown_label_raises():
    with pytest.raises(ValueError, match="대응표에 없는 라벨"):
        make_hits([0.1], [99], None, TABLE)


def test_make_hits_bad_pad_name_raises():
    with pytest.raises(ValueError, match="어휘에 없음"):
        make_hits([0.1], [1], None, {1: "COWBELL"})


def test_make_hits_empty():
    hits, dropped = make_hits([], [], None, TABLE)
    assert len(hits) == 0 and dropped == 0
    assert count_by_pad(hits) == dict.fromkeys(PADS, 0)


def test_validate_hits_rejects_unsorted():
    hits = np.array([(1.0, "KICK", -1), (0.5, "SNARE", -1)], dtype=HITS_DTYPE)
    with pytest.raises(ValueError, match="오름차순"):
        validate_hits(hits)


def test_clip_and_count():
    hits, _ = make_hits([0.2, 1.2, 2.2, 3.2], [36, 38, 36, 49], None, TABLE)
    clipped = clip_hits(hits, 1.0, 3.0)
    assert np.allclose(clipped["time_sec"], [0.2, 1.2])
    counts = count_by_pad(hits)
    assert counts["KICK"] == 2 and counts["SNARE"] == 1 and counts["CRASH"] == 1
    assert counts["RIDE"] == 0


def test_to_five_groups():
    hits, _ = make_hits([0.1, 0.2], [49, 36], None, TABLE)
    five = to_five_groups(hits)
    assert five["pad"].tolist() == ["cymbal", "kick"]
    assert hits["pad"].tolist() == ["CRASH", "KICK"]
