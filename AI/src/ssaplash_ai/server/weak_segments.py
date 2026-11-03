"""POST /analysis/weak-segments — BE가 플레이 후 호출하는 약점 구간 분석.

- 내부망 전용이다(인증 없음, 외부 포트를 열지 않는다).
- 요청 본문(타격 데이터)은 **로그에 남기지 않는다.** 검증 오류 응답에도 필드 이름만 담는다.
- 분석 후 요약(걸린 패턴, severity, 노트 수, 처리 시간)만 한 줄 로그로 남긴다. QA 때 임계값 조정 근거다.
"""

from __future__ import annotations

import logging
import sys
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from ssaplash_ai.coach.analyzer import analyze_notes
from ssaplash_ai.coach.config import MAX_BODY_BYTES
from ssaplash_ai.coach.notes import build_notes
from ssaplash_ai.coach.schema import AnalysisRequest


class _StdoutHandler(logging.StreamHandler):
    """표준 출력으로 쓰는 핸들러. 출력 대상을 쓸 때마다 `sys.stdout`에서 읽는다(시험의 출력 캡처와도 맞는다)."""

    def __init__(self) -> None:
        super().__init__(sys.stdout)

    @property
    def stream(self):  # type: ignore[override]
        return sys.stdout

    @stream.setter
    def stream(self, value) -> None:
        pass


def _configure_logger() -> logging.Logger:
    """분석 요약 로그가 컨테이너 로그(그리고 Loki)까지 가게 한다.

    uvicorn은 자기 로거만 설정하고 root에는 핸들러가 없어서, 따로 설정하지 않으면 INFO 로그가 버려진다
    (WARNING 이상만 남는다). 그래서 이 로거에만 표준 출력 핸들러를 단다. `propagate`는 그대로 둔다.
    """
    log = logging.getLogger("ssaplash_ai.coach")
    if not any(isinstance(h, _StdoutHandler) for h in log.handlers):
        handler = _StdoutHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        log.addHandler(handler)
    log.setLevel(logging.INFO)
    return log


logger = _configure_logger()
router = APIRouter()

_MAX_FIELDS_IN_ERROR = 20


def _error(status: int, code: str, fields: list[str] | None = None) -> JSONResponse:
    content: dict[str, object] = {"error": code}
    if fields is not None:
        content["fields"] = fields
    return JSONResponse(status_code=status, content=content)


def _validation_error(exc: ValidationError) -> JSONResponse:
    """오류가 난 필드 이름(경로)만 모은다. 입력 값(`input`)은 절대 꺼내지 않는다."""
    errors = exc.errors(include_input=False, include_url=False, include_context=False)
    if any(e["type"] == "too_long" and tuple(e["loc"]) == ("hits",) for e in errors):
        return _error(413, "TOO_MANY_HITS")
    if any(e["type"] in ("json_invalid", "json_type") for e in errors):
        return _error(400, "INVALID_JSON")
    fields: list[str] = []
    for e in errors:
        name = ".".join(str(p) for p in e["loc"])
        if name and name not in fields:
            fields.append(name)
    return _error(400, "INVALID_REQUEST", fields[:_MAX_FIELDS_IN_ERROR])


def process_body(body: bytes) -> JSONResponse:
    """요청 본문 하나를 처리한다. 이벤트 루프 없이 부를 수 있는 동기 함수라 직접 시험할 수 있다."""
    if len(body) > MAX_BODY_BYTES:
        return _error(413, "BODY_TOO_LARGE")
    started = time.perf_counter()
    try:
        request = AnalysisRequest.model_validate_json(body)
        notes = build_notes(request)
        response = analyze_notes(notes)
    except ValidationError as exc:
        rejected = _validation_error(exc)
        logger.info("weak-segments rejected status=%d", rejected.status_code)
        return rejected
    except Exception as exc:  # 예기치 못한 오류. 본문이 섞일 수 있어 메시지는 남기지 않는다
        logger.error("weak-segments failed: %s", type(exc).__name__)
        return _error(500, "INTERNAL_ERROR")

    elapsed_ms = (time.perf_counter() - started) * 1000
    found = ",".join(f"{s.pattern}:{s.metrics.get('severity')}" for s in response.weakSegments)
    logger.info(
        "weak-segments reason=%s notes=%d segments=[%s] goodMs=%.0f elapsedMs=%.1f",
        response.reason,
        notes.size,
        found,
        notes.good_ms,
        elapsed_ms,
    )
    # tip이 없는 항목은 키를 생략한다(구버전 BE·FE와 같은 모양을 유지)
    return JSONResponse(content=response.model_dump(exclude_none=True))


@router.post("/analysis/weak-segments")
async def weak_segments(request: Request) -> JSONResponse:
    # 본문을 읽기 전에 선언된 크기로 먼저 거른다
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return _error(413, "BODY_TOO_LARGE")
    body = await request.body()
    return await run_in_threadpool(process_body, body)
