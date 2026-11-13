"""결과 봉투의 정규 JSON 직렬화와 payloadHash.

BE(`WorkerPayload`)와 같은 규칙:
- 객체 키는 UTF-16 코드 단위 순서, 배열은 원래 순서, 공백 없음
- 문자열은 Jackson 이스케이프: `"` `\\` `\\b` `\\t` `\\n` `\\f` `\\r`, 그 밖의 제어 문자는 `\\u001F`처럼 대문자 16진수,
  나머지 유니코드는 UTF-8 그대로. 짝 없는 서러게이트는 오류
- 숫자는 Decimal로 다룸: 후행 0 제거, 지수 표기 없음, 모든 0은 `0`. float는 정밀도를 잃을 수 있어 거부하고
  repr(가장 짧은 표기, json.dumps와 같은 값)로 Decimal로 바꿔 넣음(to_wire_tree). BE 안내문의
  json.loads(parse_float=Decimal)와 같은 결과
- payloadHash는 봉투 전체가 아니라 `result` 객체만 정규 JSON으로 만든 UTF-8 바이트의 SHA-256

요청 본문도 정규 직렬화 결과 바이트를 그대로 보냄(make_envelope). 검증 벡터는 tests/worker/test_worker_payload.py.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from decimal import Decimal, localcontext
from typing import Any

CONTRACT_VERSION = 1
_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\t": "\\t",
    "\n": "\\n",
    "\f": "\\f",
    "\r": "\\r",
}
# BE가 거부하는 범위. 자릿수·지수가 이보다 크면 보내기 전에 오류
NUMBER_MAX_DIGITS = 128
NUMBER_MAX_EXPONENT = 128


def canonical(value: Any) -> str:
    """정규 JSON 문자열. 키 정렬·공백 없음·Decimal 숫자. float·그 밖의 자료형은 오류."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, (int, Decimal)):
        return _number(Decimal(value))
    if isinstance(value, float):
        raise TypeError("float는 Decimal로 바꾼 뒤 직렬화 (to_wire_tree)")
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise TypeError(f"객체 키는 문자열이어야 함: {key!r}")
        items = sorted(value, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(_string(k) + ":" + canonical(value[k]) for k in items) + "}"
    raise TypeError(f"직렬화할 수 없는 자료형: {type(value).__name__}")


def payload_hash(result: Any) -> str:
    """`result` 객체의 정규 JSON UTF-8 바이트 SHA-256, 소문자 16진수."""
    return hashlib.sha256(canonical(result).encode("utf-8")).hexdigest()


def to_wire_tree(value: Any) -> Any:
    """float를 Decimal로 바꾼 사본. float는 repr(가장 짧은 표기, json.dumps와 같음)로 읽음. NaN·무한대는 ValueError."""
    if isinstance(value, bool) or value is None or isinstance(value, (str, int, Decimal)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("NaN·무한대는 보낼 수 없음")
        return Decimal(repr(value))
    if isinstance(value, (list, tuple)):
        return [to_wire_tree(item) for item in value]
    if isinstance(value, dict):
        return {key: to_wire_tree(item) for key, item in value.items()}
    raise TypeError(f"직렬화할 수 없는 자료형: {type(value).__name__}")


@dataclass(frozen=True)
class Envelope:
    """BE에 보낼 결과 봉투. body가 요청 본문 바이트."""

    result_id: str
    payload_hash: str
    body: bytes


def make_envelope(job_id: int, attempt_id: str, result_id: str, result: dict) -> Envelope:
    """`contractVersion`·`jobId`·`attemptId`·`resultId`·`payloadHash`·`result` 봉투 → 정규 바이트."""
    wire_result = to_wire_tree(result)
    digest = payload_hash(wire_result)
    envelope = {
        "contractVersion": CONTRACT_VERSION,
        "jobId": job_id,
        "attemptId": attempt_id,
        "resultId": result_id,
        "payloadHash": digest,
        "result": wire_result,
    }
    return Envelope(result_id=result_id, payload_hash=digest, body=encode(envelope))


def encode(value: Any) -> bytes:
    """정규 JSON UTF-8 바이트. 모든 요청 본문에 씀."""
    return canonical(to_wire_tree(value)).encode("utf-8")


def _string(text: str) -> str:
    out = ['"']
    for ch in text:
        code = ord(ch)
        if ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        elif code < 0x20:
            out.append(f"\\u{code:04X}")
        elif 0xD800 <= code <= 0xDFFF:
            raise ValueError("짝 없는 서러게이트 문자")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _number(number: Decimal) -> str:
    if not number.is_finite():
        raise ValueError("유한한 숫자만 보낼 수 있음")
    if not number:
        return "0"
    with localcontext() as ctx:
        ctx.prec = max(256, len(number.as_tuple().digits) + 1)
        number = number.normalize()
    digits = number.as_tuple()
    if abs(digits.exponent) > NUMBER_MAX_EXPONENT or len(digits.digits) > NUMBER_MAX_DIGITS:
        raise ValueError("숫자 자릿수가 BE 허용 범위를 넘음")
    return format(number, "f")
