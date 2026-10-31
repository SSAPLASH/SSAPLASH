"""보정 정책 파일: 사람이 정하는 값이므로 형식 오류는 조용히 넘기지 않는다."""

from __future__ import annotations

import pytest

from ssaplash_ai.coach_calibration.candidates import GROUPS
from ssaplash_ai.coach_calibration.policy import DEFAULT_PATH, Policy, PolicyError, load_policy


def _write(tmp_path, text):
    path = tmp_path / "policy.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def test_committed_default_policy_is_valid_and_has_no_targets():
    assert DEFAULT_PATH.exists()

    policy = load_policy(DEFAULT_PATH, GROUPS)

    assert policy.targets == {}
    assert policy.max_change == 0.25 and policy.min_sample == 50


def test_missing_default_file_means_empty_policy(tmp_path, monkeypatch):
    monkeypatch.setattr("ssaplash_ai.coach_calibration.policy.DEFAULT_PATH", tmp_path / "nope.yaml")

    assert load_policy(None, GROUPS) == Policy()


def test_explicit_path_that_does_not_exist_is_an_error(tmp_path):
    """정책 파일 마운트를 빠뜨렸는데 조용히 빈 정책으로 도는 일을 막는다."""
    with pytest.raises(PolicyError):
        load_policy(tmp_path / "nope.yaml", GROUPS)


def test_valid_targets_are_loaded(tmp_path):
    path = _write(
        tmp_path,
        "version: 1\nmax_change: 0.2\nmin_sample: 80\ntargets:\n  TIMING: [0.03, 0.2]\n  UNSTEADY: [0, 0.1]\n",
    )

    policy = load_policy(path, GROUPS)

    assert policy.max_change == 0.2 and policy.min_sample == 80
    assert policy.target_of("TIMING") == (0.03, 0.2)
    assert policy.target_of("UNSTEADY") == (0.0, 0.1)
    assert policy.target_of("PAD") is None


@pytest.mark.parametrize(
    "body",
    [
        "targets:\n  TIMNG: [0.1, 0.2]\n",  # 모르는 그룹(오타)
        "targets:\n  TIMING: [0.2, 0.1]\n",  # 최소 ≥ 최대
        "targets:\n  TIMING: [0.1, 1.5]\n",  # 범위 밖
        "targets:\n  TIMING: [0.1]\n",  # 두 수가 아님
        "targets:\n  TIMING: [a, b]\n",  # 수가 아님
        "max_change: 0\n",
        "max_change: 0.9\n",
        "min_sample: 0\n",
        "min_sample: 1.5\n",
        "version: 2\n",
        "surprise: 1\n",
    ],
)
def test_invalid_policy_is_rejected(tmp_path, body):
    with pytest.raises(PolicyError):
        load_policy(_write(tmp_path, body), GROUPS)


def test_top_level_must_be_a_mapping(tmp_path):
    with pytest.raises(PolicyError):
        load_policy(_write(tmp_path, "- 1\n- 2\n"), GROUPS)
