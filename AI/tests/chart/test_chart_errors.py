"""예외 분류 테스트. 예외마다 실패 보고의 code·retryable·reason (S15P31A307-246 설계 3-1절)."""

from __future__ import annotations

import pytest

from ssaplash_ai.chart.errors import (
    REASONS,
    ChartError,
    ChartInputError,
    ChartModelError,
    ChartNotTranscribableError,
    ChartOutputError,
    ChartSilentError,
    model_error_from,
)


@pytest.mark.parametrize(
    ("error", "code", "retryable", "reason"),
    [
        (ChartInputError("못 읽음"), "INPUT_INVALID", False, "SOURCE_INVALID"),
        (ChartSilentError("입력이 무음"), "INPUT_INVALID", False, "SOURCE_INVALID"),
        (ChartNotTranscribableError("박 추적 실패"), "INPUT_INVALID", False, "NOT_TRANSCRIBABLE"),
        (ChartModelError("메모리 부족", retryable=True), "MODEL_FAILED", True, "GPU_OUT_OF_MEMORY"),
        (ChartModelError("추론 예외"), "MODEL_FAILED", False, "INTERNAL_ERROR"),
        (ChartOutputError("JSON 검증 실패"), "OUTPUT_INVALID", False, "INTERNAL_ERROR"),
    ],
)
def test_예외마다_code_retryable_reason(error: ChartError, code: str, retryable: bool, reason: str):
    assert (error.code, error.retryable, error.reason) == (code, retryable, reason)
    assert error.reason in REASONS


def test_사유_네_가지():
    assert REASONS == ("SOURCE_INVALID", "NOT_TRANSCRIBABLE", "GPU_OUT_OF_MEMORY", "INTERNAL_ERROR")


def test_채보_불가는_입력_오류의_하위라_기존_처리를_따른다():
    assert issubclass(ChartNotTranscribableError, ChartInputError)
    assert issubclass(ChartSilentError, ChartInputError)


def test_model_error_from은_메모리_부족만_GPU_OUT_OF_MEMORY():
    oom = model_error_from(RuntimeError("CUDA out of memory. Tried to allocate"), "분리")
    other = model_error_from(ValueError("shape mismatch"), "분리")
    assert oom.reason == "GPU_OUT_OF_MEMORY" and oom.retryable
    assert other.reason == "INTERNAL_ERROR" and not other.retryable
