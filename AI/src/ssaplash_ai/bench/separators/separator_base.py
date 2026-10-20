"""분리 모델 어댑터 공통 인터페이스 (설계 3-2절, 3-4절).

어댑터는 "원곡 배열을 받아 드럼 배열을 돌려주는" 같은 모양의 클래스. 모델을 추가해도
지표·보고 코드는 안 바뀜. 지표를 모르고 numpy 배열만 주고받음 (설계 2장 의존 방향).

흐름: SeparatorConfig.from_yaml → create_separator → load() → separate() 반복 → close().
길이가 어긋나면 어댑터가 잘라내거나 0으로 채워 입력 길이에 맞춤. runner는 길이를 믿음.
yaml 키는 설계 3-4절 표를 snake_case로 옮긴 것 (-103 구현 메모와 같은 규칙).
"""

from __future__ import annotations

import abc
import hashlib
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml

MODELS_DIR = Path("data/models")


@dataclass
class SeparatorConfig:
    """configs/bench/models/<어댑터>/*.yaml 한 파일. 어댑터마다 쓰는 필드가 다름."""

    name: str
    adapter: str
    license_code: str
    license_weights: str
    source_url: str = ""
    # msst
    model_type: str | None = None
    config_url: str | None = None
    checkpoint_url: str | None = None
    # demucs / openunmix
    demucs_name: str | None = None
    umx_name: str | None = None
    # 청크 처리. None이면 패키지 기본값
    segment_sec: float | None = None
    overlap: float | None = None
    batch_size: int | None = None
    # mock
    mock_mode: str = "mixture"
    fail_on_call: int | None = None
    # 예측 드럼으로 쓸 스템 이름
    drums_stem: str = "drums"
    yaml_text: str = field(default="", repr=False)
    source_path: Path | None = None

    @classmethod
    def from_yaml(cls, path: str | Path) -> SeparatorConfig:
        path = Path(path)
        text = path.read_text(encoding="utf-8")
        raw = yaml.safe_load(text)
        if not isinstance(raw, dict):
            raise ValueError(f"모델 설정이 비어 있음: {path}")
        cfg = cls.from_dict(raw)
        cfg.yaml_text = text
        cfg.source_path = path
        return cfg

    @classmethod
    def from_dict(cls, raw: dict) -> SeparatorConfig:
        for key in ("name", "adapter", "license_code", "license_weights"):
            if not raw.get(key):
                raise ValueError(f"모델 설정에 {key} 필드가 필요 (라이선스 문자열 필수, ADR-011)")
        # yaml은 ' #' 뒤를 주석으로 읽으므로 라이선스 문장이 잘리면 여기서 걸림
        for key in ("license_code", "license_weights"):
            if str(raw[key]).rstrip().endswith(("이슈", "(")):
                raise ValueError(f"{key} 값이 잘린 것 같음 (yaml에서 ' #'는 주석): {raw[key]!r}")
        known = {f for f in cls.__dataclass_fields__ if f not in ("yaml_text", "source_path")}
        unknown = sorted(set(raw) - known)
        if unknown:
            raise ValueError(f"모르는 모델 설정 필드: {unknown}")
        kwargs = {k: v for k, v in raw.items() if v is not None}
        cfg = cls(**kwargs)
        cfg.yaml_text = yaml.safe_dump(raw, allow_unicode=True, sort_keys=True)
        return cfg

    @property
    def config_hash(self) -> str:
        """yaml 내용의 sha256 앞 12자리. 3-3절 configHash."""
        return hashlib.sha256(self.yaml_text.encode("utf-8")).hexdigest()[:12]

    @property
    def model_dir(self) -> Path:
        return MODELS_DIR / self.name


@dataclass
class SeparatorInfo:
    """3-2절 info. 보고서 라이선스 열과 CSV checkpoint 열에 사용."""

    name: str
    adapter: str
    checkpoint: str
    n_params: int | None
    license_code: str
    license_weights: str
    device: str


@dataclass
class SeparationResult:
    """separate 출력. drums는 입력과 같은 (채널, 샘플) float32."""

    drums: np.ndarray
    other_stems: dict[str, np.ndarray] = field(default_factory=dict)


def fit_length(audio: np.ndarray, n_samples: int) -> np.ndarray:
    """(채널, 샘플)을 n_samples에 맞춤. 길면 자르고 짧으면 0으로 채움."""
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = np.stack([audio, audio])
    if audio.shape[1] >= n_samples:
        return np.ascontiguousarray(audio[:, :n_samples])
    pad = np.zeros((audio.shape[0], n_samples - audio.shape[1]), dtype=np.float32)
    return np.concatenate([audio, pad], axis=1)


def download_file(url: str, dest: Path, chunk_mb: int = 8) -> Path:
    """url을 dest로 내려받음. 이미 있으면 그대로. 받다 실패하면 .part만 남김."""
    if dest.is_file():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "ssaplash-bench"})
    with urllib.request.urlopen(request) as resp, open(part, "wb") as f:
        while True:
            chunk = resp.read(chunk_mb * 1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    part.replace(dest)
    return dest


class BaseSeparator(abc.ABC):
    """어댑터 공통 뼈대. 하위 클래스는 _load·_separate·_checkpoint_id·_n_params만 구현."""

    adapter: str = ""

    def __init__(self, config: SeparatorConfig, device: str = "cuda") -> None:
        self.config = config
        self.device = device
        self.load_sec: float | None = None
        self.loaded = False

    @property
    def name(self) -> str:
        return self.config.name

    def load(self) -> float:
        """가중치를 메모리에 올리고 걸린 초를 반환. 3-3절 loadSec. 파일 다운로드는 시간에서 뺌."""
        self.prepare()
        start = time.perf_counter()
        self._load()
        self.load_sec = time.perf_counter() - start
        self.loaded = True
        return self.load_sec

    def separate(self, mixture: np.ndarray, sample_rate: int) -> SeparationResult:
        """(채널 2, 샘플) 원곡 → 같은 길이의 드럼 + 나머지 스템."""
        if not self.loaded:
            raise RuntimeError(f"{self.name}: load()를 먼저 호출")
        n = mixture.shape[1]
        stems = self._separate(np.ascontiguousarray(mixture, dtype=np.float32), sample_rate)
        if self.config.drums_stem not in stems:
            raise KeyError(
                f"{self.name}: 출력에 {self.config.drums_stem!r} 스템 없음 ({sorted(stems)})"
            )
        drums = fit_length(stems.pop(self.config.drums_stem), n)
        others = {k: fit_length(v, n) for k, v in stems.items()}
        return SeparationResult(drums=drums, other_stems=others)

    def info(self) -> SeparatorInfo:
        return SeparatorInfo(
            name=self.name,
            adapter=self.adapter,
            checkpoint=self._checkpoint_id(),
            n_params=self._n_params(),
            license_code=self.config.license_code,
            license_weights=self.config.license_weights,
            device=self.device,
        )

    def close(self) -> None:
        """모델 해제. GPU 메모리 반환은 하위 클래스가 덧붙임."""
        self._close()
        self.loaded = False

    # ---- 하위 클래스 구현 ----

    def prepare(self) -> None:  # noqa: B027 - 기본은 받을 파일이 없음
        """가중치 파일 다운로드 등 load 시간에 넣지 않을 준비 작업."""

    @abc.abstractmethod
    def _load(self) -> None: ...

    @abc.abstractmethod
    def _separate(self, mixture: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        """스템 이름 → (채널, 샘플). drums_stem 키가 꼭 있어야 함."""

    @abc.abstractmethod
    def _checkpoint_id(self) -> str: ...

    def _n_params(self) -> int | None:
        return None

    def _close(self) -> None:  # noqa: B027 - 기본은 해제할 것이 없음
        pass


def count_torch_params(model) -> int | None:
    """torch 모듈(또는 모듈 목록)의 파라미터 수. torch가 없으면 None."""
    try:
        import torch
    except ImportError:
        return None
    modules = list(model) if isinstance(model, list | tuple) else [model]
    total = 0
    for m in modules:
        if not isinstance(m, torch.nn.Module):
            return None
        total += sum(p.numel() for p in m.parameters())
    return total


def release_cuda() -> None:
    """torch CUDA 캐시 비우기. torch가 없으면 아무것도 안 함."""
    try:
        import torch
    except ImportError:
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
