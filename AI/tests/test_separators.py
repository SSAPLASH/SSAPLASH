"""어댑터 인터페이스 테스트. 가짜 어댑터와 모델 yaml 파싱만 (실제 모델 실행 없음)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_tone
from ssaplash_ai.bench.separators import (
    ADAPTERS,
    FakeSeparator,
    SeparatorConfig,
    create_separator,
    fit_length,
)

MODELS_DIR = Path(__file__).resolve().parents[1] / "configs" / "bench" / "models"
REAL_MODELS = [
    "scnet_xl_ihf",
    "scnet_large",
    "bs_roformer_sw",
    "bs_roformer_musdb",
    "htdemucs_ft",
    "htdemucs",
    "spleeter",
    "umxhq",
]


def _fake(**kw) -> SeparatorConfig:
    raw = {"name": "f", "adapter": "fake", "license_code": "x", "license_weights": "y"}
    raw.update(kw)
    return SeparatorConfig.from_dict(raw)


def test_fake_어댑터는_입력과_같은_모양의_드럼을_돌려준다():
    sep = create_separator(_fake(), device="cpu")
    assert isinstance(sep, FakeSeparator)
    load_sec = sep.load()
    assert load_sec >= 0 and sep.load_sec == load_sec
    mix = make_tone(1.0)
    out = sep.separate(mix, SR)
    assert out.drums.shape == mix.shape and out.drums.dtype == np.float32
    np.testing.assert_array_equal(out.drums, mix)
    assert out.other_stems == {}


@pytest.mark.parametrize(
    "mode, factor", [("silence", 0.0), ("half", 0.5), ("drums_from_other", 0.5)]
)
def test_fake_모드별_출력(mode: str, factor: float):
    sep = create_separator(_fake(fake_mode=mode), device="cpu")
    sep.load()
    mix = make_tone(0.5)
    out = sep.separate(mix, SR)
    np.testing.assert_allclose(out.drums, factor * mix)
    if mode == "drums_from_other":
        np.testing.assert_allclose(out.other_stems["accomp"], mix - out.drums)


def test_load_전에_separate하면_에러():
    sep = create_separator(_fake(), device="cpu")
    with pytest.raises(RuntimeError):
        sep.separate(make_tone(0.1), SR)


def test_fail_on_call은_지정한_호출에서만_실패한다():
    sep = create_separator(_fake(fail_on_call=2), device="cpu")
    sep.load()
    sep.separate(make_tone(0.1), SR)
    with pytest.raises(RuntimeError):
        sep.separate(make_tone(0.1), SR)
    sep.separate(make_tone(0.1), SR)


def test_info에_라이선스와_장치가_들어간다():
    sep = create_separator(_fake(name="fx", tier="baseline"), device="cpu")
    sep.load()
    info = sep.info()
    assert info.name == "fx" and info.adapter == "fake"
    assert info.license_code == "x" and info.license_weights == "y"
    assert info.device == "cpu" and info.tier == "baseline" and info.n_params == 0
    assert info.checkpoint == "fake:mixture"


def test_close_후에는_다시_load해야_한다():
    sep = create_separator(_fake(), device="cpu")
    sep.load()
    sep.close()
    assert not sep.loaded


def test_fit_length는_자르거나_0으로_채운다():
    a = make_tone(0.1)
    n = a.shape[1]
    assert fit_length(a, n - 10).shape == (2, n - 10)
    padded = fit_length(a, n + 10)
    assert padded.shape == (2, n + 10) and np.all(padded[:, n:] == 0)
    mono = fit_length(a[0], n)
    assert mono.shape == (2, n)


def test_config_hash는_내용이_같으면_같고_다르면_다르다():
    a = _fake(name="a")
    b = _fake(name="a")
    c = _fake(name="a", tier="1")
    assert a.config_hash == b.config_hash != c.config_hash
    assert len(a.config_hash) == 12


def test_라이선스_없는_설정은_거부한다():
    with pytest.raises(ValueError, match="license_weights"):
        SeparatorConfig.from_dict({"name": "n", "adapter": "fake", "license_code": "x"})


def test_모르는_필드와_어댑터는_거부한다():
    with pytest.raises(ValueError, match="모르는 모델 설정 필드"):
        _fake(bogus=1)
    with pytest.raises(ValueError, match="모르는 어댑터"):
        create_separator(_fake(adapter="nope"))


def test_모델_어댑터는_필수_필드가_없으면_생성_단계에서_실패한다():
    with pytest.raises(ValueError, match="model_type"):
        create_separator(_fake(adapter="msst"))
    with pytest.raises(ValueError, match="demucs_name"):
        create_separator(_fake(adapter="demucs"))
    with pytest.raises(ValueError, match="umx_name"):
        create_separator(_fake(adapter="openunmix"))
    with pytest.raises(ValueError, match="spleeter_name"):
        create_separator(_fake(adapter="spleeter"))


@pytest.mark.parametrize("name", REAL_MODELS)
def test_모델_yaml마다_라이선스_문자열이_있고_어댑터를_만들_수_있다(name: str):
    cfg = SeparatorConfig.from_yaml(MODELS_DIR / f"{name}.yaml")
    assert cfg.name == name
    assert cfg.license_code and cfg.license_weights
    assert cfg.tier in ("1", "2", "baseline")
    assert cfg.adapter in ADAPTERS
    sep = create_separator(cfg, device="cpu")
    assert sep.adapter == cfg.adapter and not sep.loaded
    if cfg.adapter == "msst":
        assert cfg.config_url and cfg.checkpoint_url and cfg.model_type
        config_path, ckpt_path = sep.weight_paths()
        assert config_path.parent == Path("data/models") / name
        assert ckpt_path.suffix in (".ckpt", ".th", ".pth")


def test_fake_yaml_세_개가_있다():
    names = sorted(p.stem for p in MODELS_DIR.glob("fake_*.yaml"))
    assert names == ["fake_half", "fake_mixture", "fake_silence"]
    for n in names:
        sep = create_separator(MODELS_DIR / f"{n}.yaml", device="cpu")
        sep.load()
        assert sep.separate(make_tone(0.1), SR).drums.shape == (2, int(0.1 * SR))
