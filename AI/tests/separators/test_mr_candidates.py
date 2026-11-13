"""MR 개선 후보 옵션: 반주 만드는 방식, 고음 지속음 되돌리기, 드럼 평균, 드럼 일부만 빼기, 리미터. mock 모델만 사용."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from ssaplash_ai.bench.separators import SeparatorConfig, create_separator
from ssaplash_ai.bench.separators.msst_separator import MsstSeparator
from ssaplash_ai.bench.separators.postprocess import LIMIT_DBFS, limit_peaks, split_high_sustain

SR = 44100
BASE = {"adapter": "mock", "license_code": "x", "license_weights": "y"}
MODELS_DIR = Path(__file__).resolve().parents[2] / "configs" / "bench" / "models"
MSST_BASE = {
    "adapter": "msst",
    "license_code": "x",
    "license_weights": "y",
    "model_type": "bs_roformer",
    "config_url": "https://example.invalid/c.yaml",
    "checkpoint_url": "https://example.invalid/m.ckpt",
}


def _sep(**kw):
    sep = create_separator(SeparatorConfig.from_dict({"name": "m", **BASE, **kw}), device="cpu")
    sep.load()
    return sep


def _mix(seconds: float = 1.0) -> np.ndarray:
    rng = np.random.default_rng(0)
    return (0.1 * rng.standard_normal((2, int(seconds * SR)))).astype(np.float32)


def test_기본은_원곡에서_드럼을_뺀_반주():
    x = _mix()
    out = _sep(mock_mode="half").separate(x, SR)
    np.testing.assert_allclose(out.accomp, x - out.drums, atol=1e-6)


def test_sum_others는_드럼_외_스템을_더한_반주():
    x = _mix()
    out = _sep(mock_mode="drums_from_other", accomp_mode="sum_others").separate(x, SR)
    np.testing.assert_allclose(out.accomp, out.other_stems["accomp"], atol=1e-6)


def test_드럼_외_스템이_없으면_sum_others는_오류():
    with pytest.raises(ValueError, match="sum_others"):
        _sep(mock_mode="half", accomp_mode="sum_others").separate(_mix(), SR)


def test_모르는_반주_방식은_오류():
    with pytest.raises(ValueError, match="accomp_mode"):
        _sep(mock_mode="half", accomp_mode="mix").separate(_mix(), SR)


def test_고음_지속음을_되돌려도_드럼과_반주를_더하면_원곡이다():
    x = _mix()
    plain = _sep(mock_mode="half").separate(x, SR)
    back = _sep(mock_mode="half", high_return_hz=5000).separate(x, SR)
    assert np.sum(back.drums**2) < np.sum(plain.drums**2)
    np.testing.assert_allclose(back.drums + back.accomp, x, atol=1e-5)


def test_되돌린_성분은_기준_주파수_위에만_있다():
    t = np.arange(SR) / SR
    low_tone = np.stack([np.sin(2 * np.pi * 300 * t)] * 2).astype(np.float32)
    sustain = split_high_sustain(low_tone, SR, 5000)
    assert np.max(np.abs(sustain)) < 1e-3  # 300Hz 지속음은 기준 아래라 그대로 둠
    high_tone = np.stack([np.sin(2 * np.pi * 8000 * t)] * 2).astype(np.float32)
    assert np.sum(split_high_sustain(high_tone, SR, 5000) ** 2) > 0.5 * np.sum(high_tone**2)


def test_드럼_평균은_멤버_드럼의_평균(tmp_path: Path):
    paths = []
    for mode in ("half", "silence"):
        p = tmp_path / f"{mode}.yaml"
        p.write_text(
            f"name: {mode}\nadapter: mock\nlicense_code: x\nlicense_weights: y\nmock_mode: {mode}\n",
            encoding="utf-8",
        )
        paths.append(str(p))
    x = _mix()
    sep = _sep(adapter="ensemble", members=paths)
    out = sep.separate(x, SR)
    np.testing.assert_allclose(out.drums, 0.25 * x, atol=1e-6)
    assert sep.info().checkpoint == "mock:half+mock:silence"
    sep.close()


def test_멤버가_하나면_오류():
    with pytest.raises(ValueError, match="둘 이상"):
        _sep(adapter="ensemble", members=["a.yaml"])


def _fake_msst_separator(monkeypatch) -> dict:
    """msst.Separator를 생성 인자만 기록하는 가짜로 바꿈. 가중치 파일 없이 _load를 시험."""
    import msst

    seen: dict = {}

    class FakeSeparator:
        def __init__(self, **kwargs) -> None:
            seen.update(kwargs)
            self._config = None

    monkeypatch.setattr(msst, "Separator", FakeSeparator)
    return seen


def test_msst_어댑터는_use_tta를_msst에_넘기고_기본은_끔(monkeypatch):
    seen = _fake_msst_separator(monkeypatch)
    sep = create_separator(SeparatorConfig.from_dict({"name": "t", **MSST_BASE}), device="cpu")
    assert isinstance(sep, MsstSeparator)
    sep._load()
    assert seen["use_tta"] is False and seen["force_cpu"] is True

    seen.clear()
    create_separator(
        SeparatorConfig.from_dict({"name": "t", **MSST_BASE, "use_tta": True}), device="cpu"
    )._load()
    assert seen["use_tta"] is True


def test_후보_G_yaml은_같은_가중치로_tta만_켠다():
    cfg = SeparatorConfig.from_yaml(MODELS_DIR / "msst" / "bs_roformer_sw_tta.yaml")
    base = SeparatorConfig.from_yaml(MODELS_DIR / "msst" / "bs_roformer_sw.yaml")
    assert cfg.use_tta is True and base.use_tta is False
    assert cfg.weights_name == "bs_roformer_sw" and cfg.model_dir == base.model_dir
    assert (cfg.config_url, cfg.checkpoint_url) == (base.config_url, base.checkpoint_url)


def test_accomp_drum_ratio만큼만_드럼을_뺀다():
    x = _mix()
    out = _sep(mock_mode="half", accomp_drum_ratio=0.95).separate(x, SR)
    np.testing.assert_allclose(out.accomp, x - 0.95 * out.drums, atol=1e-6)
    np.testing.assert_allclose(out.drums, 0.5 * x, atol=1e-6)  # 드럼 트랙은 그대로


@pytest.mark.parametrize("ratio", [0.0, 1.2])
def test_accomp_drum_ratio가_범위_밖이면_오류(ratio):
    with pytest.raises(ValueError, match="accomp_drum_ratio"):
        _sep(mock_mode="half", accomp_drum_ratio=ratio).separate(_mix(), SR)


def test_리미터는_상한을_안_넘는_소리를_그대로_둔다():
    x = _mix()
    y, reduced_db = limit_peaks(x, SR)
    np.testing.assert_array_equal(y, x)
    assert reduced_db == 0.0


def test_리미터는_피크만_누르고_먼_곳과_좌우_비율은_그대로():
    # 2초 조용한 소리 가운데 0.5초에 피크 2.0 임펄스. 좌우 크기가 다름
    x = np.full((2, 2 * SR), 0.2, dtype=np.float32)
    x[1] *= 0.5
    x[:, SR // 2] = [2.0, 1.0]
    y, reduced_db = limit_peaks(x, SR)
    limit = 10 ** (LIMIT_DBFS / 20)
    assert float(np.max(np.abs(y))) <= limit + 1e-6
    assert reduced_db == pytest.approx(20 * np.log10(limit / 2.0), abs=0.01)
    # 되돌리는 시간 상수 100ms의 10배 넘게 떨어진 곳은 이득이 1과 0.01dB 안쪽
    np.testing.assert_allclose(y[:, int(1.6 * SR) :], x[:, int(1.6 * SR) :], rtol=1e-3)
    # 피크 5ms 앞부터 미리 줄이기 시작함
    assert y[0, SR // 2 - 100] < x[0, SR // 2 - 100]
    np.testing.assert_allclose(y[1] / x[1], y[0] / x[0], atol=1e-6)


def test_output_limiter를_켜면_반주에만_리미터():
    x = (_mix() * 30).astype(np.float32)  # 피크가 1을 넘는 원곡
    off = _sep(mock_mode="half").separate(x, SR)
    on = _sep(mock_mode="half", output_limiter=True).separate(x, SR)
    assert float(np.max(np.abs(off.accomp))) > 1.0
    assert float(np.max(np.abs(on.accomp))) <= 10 ** (LIMIT_DBFS / 20) + 1e-6
    np.testing.assert_array_equal(on.drums, off.drums)
