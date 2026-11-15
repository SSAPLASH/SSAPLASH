"""채보 모델 어댑터. yaml의 adapter 값으로 구현체 선택. runner는 create_transcriber만 호출.

모델 패키지(torch·adtof_pytorch·msst)는 어댑터 안에서 늦게 import하므로
mock 어댑터와 단위 테스트는 `uv sync --extra transcribers` 없이 동작.
별도 환경이 필요한 모델(ADT_STR·IDM·Omnizart·YourMT3+·drum2midi)은 external 어댑터 + scripts/transcribers_ext/ 스크립트.
STRUM 8종 온셋 CRNN(strum_crnn)은 torch·torchaudio만 써서 같은 환경에서 돎.
"""

from __future__ import annotations

from pathlib import Path

from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import AdtofDrumsepTranscriber
from ssaplash_ai.bench.transcribers.adtof_transcriber import AdtofTranscriber
from ssaplash_ai.bench.transcribers.external_transcriber import (
    BatchItem,
    BatchOutput,
    ExternalTranscriber,
    venv_python,
)
from ssaplash_ai.bench.transcribers.mock_transcriber import MockTranscriber, write_truth_csv
from ssaplash_ai.bench.transcribers.strum_transcriber import StrumCrnnTranscriber
from ssaplash_ai.bench.transcribers.transcriber_base import (
    GM_PAD_PITCH,
    MODELS_DIR,
    BaseTranscriber,
    RawHit,
    TranscriberConfig,
    TranscriberInfo,
    TranscriptionResult,
    apply_labels,
    hits_to_midi,
    map_label,
    midi_raw_hits,
    resample,
    to_mono,
    write_temp_wav,
)

ADAPTERS: dict[str, type[BaseTranscriber]] = {
    cls.adapter: cls
    for cls in (
        MockTranscriber,
        AdtofTranscriber,
        AdtofDrumsepTranscriber,
        ExternalTranscriber,
        StrumCrnnTranscriber,
    )
}


def create_transcriber(
    config: TranscriberConfig | str | Path, device: str = "cuda"
) -> BaseTranscriber:
    """yaml 경로나 TranscriberConfig를 받아 adapter에 맞는 어댑터 생성. 가중치는 load()에서."""
    if not isinstance(config, TranscriberConfig):
        config = TranscriberConfig.from_yaml(config)
    try:
        cls = ADAPTERS[config.adapter]
    except KeyError as e:
        raise ValueError(f"모르는 어댑터: {config.adapter} (가능: {sorted(ADAPTERS)})") from e
    return cls(config, device)


__all__ = [
    "ADAPTERS",
    "AdtofDrumsepTranscriber",
    "AdtofTranscriber",
    "BatchItem",
    "BatchOutput",
    "ExternalTranscriber",
    "GM_PAD_PITCH",
    "MODELS_DIR",
    "BaseTranscriber",
    "MockTranscriber",
    "RawHit",
    "StrumCrnnTranscriber",
    "TranscriberConfig",
    "TranscriberInfo",
    "TranscriptionResult",
    "apply_labels",
    "create_transcriber",
    "hits_to_midi",
    "map_label",
    "midi_raw_hits",
    "resample",
    "to_mono",
    "venv_python",
    "write_temp_wav",
    "write_truth_csv",
]
