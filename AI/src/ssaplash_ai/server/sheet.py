"""POST /chart/sheet — BE가 MusicXML 업로드 때 동기로 부르는 드럼 악보 → 채보 변환.

- 내부망 전용(인증 없음, 외부 포트를 열지 않는다). 약점 분석과 같다.
- 본문은 파일 바이트 그대로(`application/octet-stream`), 파일 이름은 쿼리 `name`. 확장자로 `.mxl`(zip)과 XML을 가른다.
- 변환은 `chart/sheet/convert.py` 그대로이고 설정은 서비스 값 `configs/chart/sheet.yaml`이다
  (환경 변수 `SSAPLASH_SHEET_CONFIG`로 바꾼다). 결과 모양은 BE `WorkerResults`가 받는 음원 채보와 같다.
- **악보 본문·파일 이름은 로그에 남기지 않는다.** 요약 한 줄(노트 수·마디 수·길이·걸린 ms)만 남긴다.
- 임시 파일은 응답 전에 지운다.

응답: 200 `{"chart": <chart.json>, "sheet": <변환 메타>}` · 400 `INPUT_INVALID` · 413 `BODY_TOO_LARGE` · 422 `NO_DRUM_NOTES` · 500 `INTERNAL_ERROR`.
오류 본문은 `{"error": 코드}`이고 400·422에는 `"message": 한 줄`이 더 붙는다. message는 BE가 사용자에게 그대로 보여 줄 수 있는 문구다.
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ssaplash_ai.chart.errors import ChartError, ChartInputError, ChartNoDrumError
from ssaplash_ai.chart.sheet import DEFAULT_SHEET_CONFIG, SheetConfig, convert_sheet
from ssaplash_ai.chart.sheet.convert import SHEET_SUFFIXES
from ssaplash_ai.server.weak_segments import _StdoutHandler

MAX_BODY_BYTES = 5 * 1024 * 1024
# 임시 폴더의 부모. None이면 시스템 임시 폴더. 시험에서 바꿔 정리를 확인한다.
TMP_ROOT: Path | None = None
CONFIG_ENV = "SSAPLASH_SHEET_CONFIG"

router = APIRouter()
logger = logging.getLogger("ssaplash_ai.chart.sheet")
if not any(isinstance(h, _StdoutHandler) for h in logger.handlers):
    _handler = _StdoutHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)

_config: SheetConfig | None = None


def config() -> SheetConfig:
    """서비스 설정. 처음 쓸 때 읽고 그 뒤로는 같은 값을 쓴다."""
    global _config
    if _config is None:
        _config = SheetConfig.from_yaml(os.environ.get(CONFIG_ENV, str(DEFAULT_SHEET_CONFIG)))
    return _config


def _error(status: int, code: str, message: str | None = None) -> JSONResponse:
    content: dict[str, object] = {"error": code}
    if message is not None:
        content["message"] = message
    return JSONResponse(status_code=status, content=content)


def process_upload(name: str | None, body: bytes) -> JSONResponse:
    """요청 하나를 처리한다. 이벤트 루프 없이 부를 수 있는 동기 함수라 직접 시험할 수 있다."""
    if len(body) > MAX_BODY_BYTES:
        return _error(413, "BODY_TOO_LARGE")
    if not name:
        return _error(400, "INPUT_INVALID", "name 쿼리에 파일 이름이 필요함")
    # 경로 구분자를 떼서 임시 폴더 밖을 가리키지 못하게 한다
    suffix = Path(Path(name).name).suffix.lower()
    if suffix not in SHEET_SUFFIXES:
        return _error(400, "INPUT_INVALID", f"MusicXML 파일만 받음 ({', '.join(SHEET_SUFFIXES)})")
    if not body:
        return _error(400, "INPUT_INVALID", "본문이 비어 있음")

    started = time.perf_counter()
    try:
        cfg = config()
        with tempfile.TemporaryDirectory(dir=TMP_ROOT, prefix="sheet-") as work:
            path = Path(work) / f"score{suffix}"
            path.write_bytes(body)
            output = convert_sheet(path, cfg)
    except ChartNoDrumError as exc:
        logger.info("sheet rejected code=NO_DRUM_NOTES")
        return _error(422, "NO_DRUM_NOTES", str(exc))
    except ChartInputError as exc:
        logger.info("sheet rejected code=%s", exc.code)
        return _error(400, "INPUT_INVALID", str(exc))
    except ChartError as exc:
        logger.error("sheet failed: %s", type(exc).__name__)
        return _error(500, "INTERNAL_ERROR")
    except Exception as exc:  # 설정 파일 오류 등. 본문이 섞일 수 있어 메시지는 남기지 않는다
        logger.error("sheet failed: %s", type(exc).__name__)
        return _error(500, "INTERNAL_ERROR")

    elapsed_ms = (time.perf_counter() - started) * 1000
    meta = output.to_dict()
    meta.pop("chart_json_path", None)
    logger.info(
        "sheet notes=%d measures=%d/%d durationMs=%d dropped=%d version=%s elapsedMs=%.1f",
        output.n_notes,
        output.measures_played,
        output.measures_written,
        output.duration_ms,
        sum(output.dropped.values()),
        output.generator_version,
        elapsed_ms,
    )
    return JSONResponse(content={"chart": output.chart, "sheet": meta})


@router.post("/chart/sheet")
async def sheet(request: Request, name: str | None = None) -> JSONResponse:
    # 본문을 읽기 전에 선언된 크기로 먼저 거른다
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return _error(413, "BODY_TOO_LARGE")
    body = await request.body()
    return await run_in_threadpool(process_upload, name, body)
