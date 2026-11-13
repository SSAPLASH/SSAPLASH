"""추론 모듈 예외 분류. 워커가 BE 실패 보고의 code·retryable·reason으로 바꿈.

| 예외 | 언제 | code | retryable |
| --- | --- | --- | --- |
| ChartInputError | 못 읽는 파일, 길이 초과, 무음, 샘플레이트 이상 | INPUT_INVALID | 거짓 |
| ChartModelError | 가중치 없음·다운로드 실패, GPU 메모리 부족, 추론 중 예외 | MODEL_FAILED | 메모리 부족만 참 |
| ChartOutputError | JSON 검증 실패, 파일 쓰기 실패 | OUTPUT_INVALID | 거짓 |

| reason | 예외 |
| --- | --- |
| SOURCE_INVALID | ChartInputError (ChartSilentError 포함) |
| NOT_TRANSCRIBABLE | ChartNotTranscribableError |
| GPU_OUT_OF_MEMORY | ChartModelError 중 retryable 참 |
| INTERNAL_ERROR | 그 밖의 ChartModelError, ChartOutputError, 워커 내부 예외 |
"""

from __future__ import annotations

MESSAGE_LIMIT = 200
REASON_SOURCE_INVALID = "SOURCE_INVALID"
REASON_NOT_TRANSCRIBABLE = "NOT_TRANSCRIBABLE"
REASON_GPU_OUT_OF_MEMORY = "GPU_OUT_OF_MEMORY"
REASON_INTERNAL_ERROR = "INTERNAL_ERROR"
REASONS = (
    REASON_SOURCE_INVALID,
    REASON_NOT_TRANSCRIBABLE,
    REASON_GPU_OUT_OF_MEMORY,
    REASON_INTERNAL_ERROR,
)
# 메시지에 이 문구가 있으면 GPU 메모리 부족으로 봄 (torch·cuDNN·CUDA 런타임)
OOM_MARKERS = ("out of memory", "cudnn_status_alloc_failed", "cublas_status_alloc_failed")


class ChartError(Exception):
    """추론 모듈 예외의 공통 조상. code·retryable·reason은 워커 실패 보고 필드."""

    code: str = "CHART_FAILED"
    retryable: bool = False
    reason: str = REASON_INTERNAL_ERROR

    def __init__(self, message: str, *, retryable: bool | None = None) -> None:
        super().__init__(message)
        if retryable is not None:
            self.retryable = retryable

    @property
    def message(self) -> str:
        return str(self.args[0]) if self.args else ""


class ChartInputError(ChartError):
    """입력 오류. 모델을 돌리기 전에 남. 재시도 안 함."""

    code = "INPUT_INVALID"
    reason = REASON_SOURCE_INVALID


class ChartSilentError(ChartInputError):
    """입력 파일이 무음. 원곡이면 SOURCE_INVALID, 채보 모듈은 드럼 트랙 무음으로 바꿔 올림."""


class ChartNotTranscribableError(ChartInputError):
    """채보를 만들 수 없음. 음악이 아닌 파일(분리 전 음악 여부 검사), 드럼 트랙 무음, 노트 수 기준 미달, 박 추적 실패."""

    reason = REASON_NOT_TRANSCRIBABLE


class ChartNoDrumError(ChartInputError):
    """악보에 드럼 파트가 없거나 패드로 바꿀 음표가 없음. AI 서버 라우터만 이 예외를 422 NO_DRUM_NOTES로 냄."""


class ChartModelError(ChartError):
    """모델 오류. 가중치 준비·올리기·추론 중 예외. GPU 메모리 부족이면 retryable 참."""

    code = "MODEL_FAILED"

    @property
    def reason(self) -> str:  # type: ignore[override]
        """GPU 메모리 부족(retryable 참)이면 GPU_OUT_OF_MEMORY, 아니면 INTERNAL_ERROR."""
        return REASON_GPU_OUT_OF_MEMORY if self.retryable else REASON_INTERNAL_ERROR


class ChartOutputError(ChartError):
    """출력 오류. 파일 쓰기 실패, JSON 검증 실패."""

    code = "OUTPUT_INVALID"


def is_out_of_memory(exc: BaseException) -> bool:
    """GPU 메모리 부족 예외인지. torch.cuda.OutOfMemoryError 또는 메시지 문구로 판단."""
    if type(exc).__name__ == "OutOfMemoryError":
        return True
    text = str(exc).lower()
    return any(marker in text for marker in OOM_MARKERS)


def summarize_exception(exc: BaseException, limit: int = MESSAGE_LIMIT) -> str:
    """예외 종류와 메시지 첫 줄만. limit 글자를 넘으면 자름."""
    text = str(exc).strip()
    first_line = text.splitlines()[0] if text else ""
    summary = f"{type(exc).__name__}: {first_line}" if first_line else type(exc).__name__
    return summary if len(summary) <= limit else summary[: limit - 3] + "..."


def model_error_from(exc: BaseException, stage: str) -> ChartModelError:
    """모델 단계 예외를 ChartModelError로 감쌈. 호출하는 쪽에서 `raise ... from exc`."""
    if is_out_of_memory(exc):
        return ChartModelError(f"{stage} 실패: GPU 메모리 부족", retryable=True)
    return ChartModelError(f"{stage} 실패: {summarize_exception(exc)}", retryable=False)
