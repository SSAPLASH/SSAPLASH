"""ZFTurbo MSST(msst 패키지) 어댑터. SCNet·BS/Mel RoFormer·MDX23C 설정 공용.

yaml 필드: model_type(msst --model_type 값), config_url, checkpoint_url, use_tta(선택).
받은 파일은 SSAPLASH_MODELS_DIR(없으면 data/models) 아래 {weights_name 또는 name}/ 에 둠. `uv sync --extra models` 필요.
msst.Separator.separate는 스템 이름 → (채널, 샘플) dict를 돌려주며 입력 샘플레이트가
모델과 다르면 내부에서 변환함.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ssaplash_ai.bench.separators.separator_base import (
    BaseSeparator,
    SeparatorConfig,
    count_torch_params,
    download_file,
    release_cuda,
)


def _filename(url: str) -> str:
    return url.rsplit("/", 1)[-1].split("?", 1)[0]


class MsstSeparator(BaseSeparator):
    adapter = "msst"

    def __init__(self, config: SeparatorConfig, device: str = "cuda") -> None:
        super().__init__(config, device)
        for key in ("model_type", "config_url", "checkpoint_url"):
            if not getattr(config, key):
                raise ValueError(f"msst 어댑터에는 {key}가 필요: {config.name}")
        self._sep = None

    def weight_paths(self) -> tuple[Path, Path]:
        d = self.config.model_dir
        return d / _filename(self.config.config_url), d / _filename(self.config.checkpoint_url)

    def download(self) -> tuple[Path, Path]:
        """설정·체크포인트 파일이 없으면 내려받음."""
        config_path, ckpt_path = self.weight_paths()
        download_file(self.config.config_url, config_path)
        download_file(self.config.checkpoint_url, ckpt_path)
        return config_path, ckpt_path

    def prepare(self) -> None:
        self.download()

    def _load(self) -> None:
        from msst import Separator

        config_path, ckpt_path = self.weight_paths()
        self._sep = Separator(
            config_path=config_path,
            checkpoint_path=ckpt_path,
            model_type=self.config.model_type,
            device_ids=0,
            force_cpu=not self.device.startswith("cuda"),
            use_tta=bool(self.config.use_tta),
            detailed_progress=False,
        )
        self._apply_chunk_overrides()

    def _apply_chunk_overrides(self) -> None:
        """yaml의 overlap·batch_size가 있으면 msst 설정에 덮어씀. 내부 속성이라 실패해도 무시."""
        inference = getattr(getattr(self._sep, "_config", None), "inference", None)
        if inference is None:
            return
        if self.config.overlap is not None and hasattr(inference, "num_overlap"):
            inference.num_overlap = int(self.config.overlap)
        if self.config.batch_size is not None and hasattr(inference, "batch_size"):
            inference.batch_size = int(self.config.batch_size)

    def _separate(self, mixture: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        stems = self._sep.separate(mixture, sample_rate=sample_rate, channels_first=True)
        return {k: np.asarray(v, dtype=np.float32) for k, v in stems.items()}

    def _checkpoint_id(self) -> str:
        return _filename(self.config.checkpoint_url)

    def _n_params(self) -> int | None:
        return count_torch_params(getattr(self._sep, "_model", None))

    def _close(self) -> None:
        if self._sep is not None:
            self._sep.close()
            self._sep = None
        release_cuda()
