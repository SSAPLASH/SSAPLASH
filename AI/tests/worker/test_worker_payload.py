"""정규 JSON 직렬화·payloadHash 테스트. 검증 벡터는 BE 안내문(최진우, 10/27)의 값 그대로."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from ssaplash_ai.worker.payload import (
    canonical,
    encode,
    make_envelope,
    payload_hash,
    to_wire_tree,
)

VECTOR_1 = '{"b":[true,null],"a":1.00}'
VECTOR_1_CANONICAL = '{"a":1,"b":[true,null]}'
VECTOR_1_HASH = "1cc69c7fa23616ca2ec3ee70d24390a6225c8832db8a4c814c7e0e7f942f8668"
# 두 번째 키는 사용자 영역 문자 U+E000. 안내문에서는 빈 문자열처럼 보여 BE 회신 4(10/30)로 확인함
VECTOR_2 = '{"😀":-0.00,"\\uE000":1.2300,"제어":"x\\u001f\\n","prec":0.12345678901234567890123456789012345}'
VECTOR_2_HASH = "a6385d023ac91b8d496887d40c7f840cf7790eb20ddc16ae866e0a080c541921"
# 키 순서는 UTF-16 코드 단위 순: "prec" < "제어"(C81C) < "😀"(D83D DE00) < U+E000
VECTOR_2_CANONICAL = (
    '{"prec":0.12345678901234567890123456789012345,"제어":"x\\u001F\\n","😀":0,"":1.23}'
)


def _load(text: str):
    return json.loads(text, parse_float=Decimal, parse_int=Decimal)


def _reference_canonical(v):
    """BE 안내문(최진우, 10/27)의 파이썬 참조 함수 원문. 우리 구현과 대조하는 기준."""
    from decimal import localcontext

    def string(s):
        out = '"'
        escapes = {
            '"': '\\"',
            "\\": "\\\\",
            "\b": "\\b",
            "\t": "\\t",
            "\n": "\\n",
            "\f": "\\f",
            "\r": "\\r",
        }
        for c in s:
            if c in escapes:
                out += escapes[c]
            elif ord(c) < 32:
                out += f"\\u{ord(c):04X}"  # 원문은 % 서식, 같은 결과
            elif 0xD800 <= ord(c) <= 0xDFFF:
                raise ValueError("unpaired surrogate")
            else:
                out += c
        return out + '"'

    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, str):
        return string(v)
    if isinstance(v, (int, Decimal)):
        n = Decimal(v)
        if not n.is_finite():
            raise ValueError("non-finite number")
        if not n:
            return "0"
        with localcontext() as ctx:
            ctx.prec = max(256, len(n.as_tuple().digits) + 1)
            n = n.normalize()
        if abs(n.as_tuple().exponent) > 128 or len(n.as_tuple().digits) > 128:
            raise ValueError("number out of range")
        return format(n, "f")
    if isinstance(v, list):
        return "[" + ",".join(_reference_canonical(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v, key=lambda x: x.encode("utf-16-be"))
        return "{" + ",".join(string(k) + ":" + _reference_canonical(v[k]) for k in keys) + "}"
    raise TypeError(type(v))


def test_검증_벡터_1_정규_JSON과_해시():
    value = _load(VECTOR_1)
    assert canonical(value) == VECTOR_1_CANONICAL
    assert payload_hash(value) == VECTOR_1_HASH


def test_검증_벡터_2_해시와_참조_함수_일치():
    value = _load(VECTOR_2)
    assert canonical(value) == _reference_canonical(value) == VECTOR_2_CANONICAL
    assert payload_hash(value) == VECTOR_2_HASH


@pytest.mark.parametrize(
    "value",
    [
        {"a": [Decimal("1.50"), {"z": None, "y": True}], "\t": "탭", "😀": Decimal("-0")},
        {"n": [Decimal("1E+3"), Decimal("0.000"), -5, Decimal("123.4560")]},
        {"s": 'q"b\\s\x01\x1f\x7f'},
    ],
)
def test_여러_값에서_참조_함수와_같다(value):
    assert canonical(value) == _reference_canonical(value)


def test_벡터_2의_규칙_하나씩():
    value = _load(VECTOR_2)
    text = canonical(value)
    # 키는 UTF-16 코드 단위 순: "prec" < "제어" < "😀"(서러게이트 쌍 D83D) < U+E000. 코드 포인트 순이면 😀가 마지막
    assert text.startswith('{"prec":0.12345678901234567890123456789012345,"제어":')
    assert text.endswith(',"😀":0,"":1.23}')
    # 제어 문자는 대문자 16진수, 줄바꿈은 \n
    assert '"x\\u001F\\n"' in text
    # -0.00은 0, 후행 0 제거
    assert '"😀":0' in text


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("1.00"), "1"),
        (Decimal("-0.00"), "0"),
        (Decimal("1E+2"), "100"),
        (Decimal("0.000100"), "0.0001"),
        (Decimal("-12.50"), "-12.5"),
        (0, "0"),
        (42, "42"),
        (-7, "-7"),
    ],
)
def test_숫자_표기(value, expected):
    assert canonical(value) == expected


def test_float는_거부하고_to_wire_tree로_바꾼다():
    with pytest.raises(TypeError, match="Decimal"):
        canonical({"a": 1.5})
    wire = to_wire_tree({"a": 1.5, "b": 120.0, "c": [0.1, None, True], "d": "x"})
    assert canonical(wire) == '{"a":1.5,"b":120,"c":[0.1,null,true],"d":"x"}'
    assert isinstance(wire["a"], Decimal) and isinstance(wire["c"][0], Decimal)


def test_NaN_무한대는_ValueError():
    with pytest.raises(ValueError):
        to_wire_tree({"a": float("nan")})
    with pytest.raises(ValueError):
        to_wire_tree({"a": float("inf")})
    with pytest.raises(ValueError, match="유한"):
        canonical(Decimal("Infinity"))


def test_문자열_이스케이프():
    assert canonical('a"b\\c\b\t\n\f\r') == '"a\\"b\\\\c\\b\\t\\n\\f\\r"'
    assert canonical("\x00\x1f") == '"\\u0000\\u001F"'
    assert canonical("한글 é 😀") == '"한글 é 😀"'  # 유니코드는 그대로
    with pytest.raises(ValueError, match="서러게이트"):
        canonical("\ud800")


def test_키가_문자열이_아니면_TypeError():
    with pytest.raises(TypeError, match="키"):
        canonical({1: "a"})


def test_bool은_숫자가_아니다():
    assert canonical([True, False, None, 1, 0]) == "[true,false,null,1,0]"


def test_봉투는_result만_해시하고_본문은_정규_바이트():
    result = {"durationMs": 1000, "metrics": {"peakRamMb": 512.5, "peakVramMb": None}}
    env = make_envelope(42, "11111111-1111-4111-8111-111111111111", "r-1", result)
    assert env.payload_hash == payload_hash(to_wire_tree(result))
    body = json.loads(env.body.decode("utf-8"), parse_float=Decimal, parse_int=Decimal)
    assert body["contractVersion"] == 1 and body["jobId"] == 42 and body["resultId"] == "r-1"
    assert body["attemptId"] == "11111111-1111-4111-8111-111111111111"
    assert body["payloadHash"] == env.payload_hash
    assert (
        canonical(body["result"])
        == '{"durationMs":1000,"metrics":{"peakRamMb":512.5,"peakVramMb":null}}'
    )
    # 본문 자체가 정규 형식(키 정렬, 공백 없음)
    assert env.body.startswith(b'{"attemptId":"11111111') and b" " not in env.body


def test_같은_result는_값_표기가_달라도_같은_해시():
    a = payload_hash(to_wire_tree({"x": 1.0, "y": [1, 2]}))
    b = payload_hash(_load('{"y":[1,2],"x":1.000}'))
    assert a == b


def test_encode는_요청_본문_바이트():
    assert (
        encode({"workerId": "w1", "claimRequestId": "c"})
        == b'{"claimRequestId":"c","workerId":"w1"}'
    )
