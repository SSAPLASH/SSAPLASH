"""로컬 모델 서버 생성기: Ollama·OpenAI 호환 두 형식, 오류 처리. 실제 서버 없이 가짜 세션으로 본다."""

from __future__ import annotations

import pytest
import requests

from ssaplash_ai.coach.llm_local import GeneratorError, LocalServerGenerator


class _Response:
    def __init__(self, status: int, body: object = None, text: str = "") -> None:
        self.status_code = status
        self._body = body
        self.text = text

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class _Session:
    def __init__(self, *items) -> None:
        self.items = list(items)
        self.calls: list[dict] = []

    def post(self, url, json, timeout):
        self.calls.append({"url": url, "json": dict(json), "timeout": timeout})
        item = self.items.pop(0) if len(self.items) > 1 else self.items[0]
        if isinstance(item, Exception):
            raise item
        return item


def _gen(*items, api="ollama", **kwargs):
    session = _Session(*items)
    gen = LocalServerGenerator("http://127.0.0.1:11434/", "m1", api=api, session=session, **kwargs)  # type: ignore[arg-type]
    return gen, session


def test_ollama_형식으로_부르고_내용을_꺼낸다():
    gen, session = _gen(_Response(200, {"message": {"role": "assistant", "content": "잘 쳤어요."}}))

    assert gen("시스템", "사용자") == "잘 쳤어요."
    call = session.calls[0]
    assert call["url"] == "http://127.0.0.1:11434/api/chat"
    assert call["json"]["model"] == "m1" and call["json"]["stream"] is False
    assert call["json"]["messages"] == [
        {"role": "system", "content": "시스템"},
        {"role": "user", "content": "사용자"},
    ]
    assert call["json"]["options"] == {
        "temperature": 0.3,
        "num_predict": 160,
        "num_ctx": 4096,
    }


def test_openai_호환_형식으로_부르고_내용을_꺼낸다():
    gen, session = _gen(
        _Response(200, {"choices": [{"message": {"content": "좋아요."}}]}), api="openai"
    )

    assert gen("s", "u") == "좋아요."
    call = session.calls[0]
    assert call["url"] == "http://127.0.0.1:11434/v1/chat/completions"
    assert call["json"]["max_tokens"] == 160 and call["json"]["temperature"] == 0.3


def test_연결_오류와_시간_초과는_GeneratorError이다():
    for error in (requests.ConnectionError("x"), requests.Timeout("x")):
        gen, _ = _gen(error)

        with pytest.raises(GeneratorError, match="닿지 못함"):
            gen("s", "u")


def test_200이_아니면_GeneratorError이다():
    gen, _ = _gen(_Response(500))

    with pytest.raises(GeneratorError, match="500"):
        gen("s", "u")


@pytest.mark.parametrize("body", [{}, {"message": {}}, {"message": {"content": 3}}, None])
def test_응답_모양이_다르면_GeneratorError이다(body):
    gen, _ = _gen(_Response(200, body))

    with pytest.raises(GeneratorError, match="모양"):
        gen("s", "u")


def test_모르는_형식과_빈_모델_이름은_거절한다():
    with pytest.raises(ValueError, match="지원하지 않는"):
        LocalServerGenerator("http://x", "m", api="gpt")
    with pytest.raises(ValueError, match="비어"):
        LocalServerGenerator("http://x", " ")


def test_생각_모드를_기본으로_끄고_보낸다():
    gen, session = _gen(_Response(200, {"message": {"content": "좋아요."}}))

    gen("s", "u")

    assert session.calls[0]["json"]["think"] is False


def test_생각_모드를_모르는_모델이면_그_항목_없이_한_번_더_보낸다():
    gen, session = _gen(
        _Response(400, text='{"error":"model does not support thinking"}'),
        _Response(200, {"message": {"content": "좋아요."}}),
    )

    assert gen("s", "u") == "좋아요."
    assert "think" in session.calls[0]["json"] and "think" not in session.calls[1]["json"]


def test_think가_None이면_보내지_않는다():
    gen, session = _gen(_Response(200, {"message": {"content": "좋아요."}}), think=None)

    gen("s", "u")

    assert "think" not in session.calls[0]["json"]


def test_답이_비어_오면_GeneratorError이다():
    gen, _ = _gen(_Response(200, {"message": {"content": "  "}}))

    with pytest.raises(GeneratorError, match="비어"):
        gen("s", "u")


def test_json_output이면_ollama에_format_json을_보낸다():
    gen, session = _gen(_Response(200, {"message": {"content": "{}"}}), json_output=True)

    gen("s", "u")

    assert session.calls[0]["json"]["format"] == "json"
    plain, plain_session = _gen(_Response(200, {"message": {"content": "{}"}}))
    plain("s", "u")
    assert "format" not in plain_session.calls[0]["json"]
