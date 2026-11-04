"""로컬 모델 서버 생성기: Ollama·OpenAI 호환 두 형식, 오류 처리. 실제 서버 없이 가짜 세션으로 본다."""

from __future__ import annotations

import pytest
import requests

from ssaplash_ai.coach.llm_local import GeneratorError, LocalServerGenerator


class _Response:
    def __init__(self, status: int, body: object = None) -> None:
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class _Session:
    def __init__(self, item) -> None:
        self.item = item
        self.calls: list[dict] = []

    def post(self, url, json, timeout):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        if isinstance(self.item, Exception):
            raise self.item
        return self.item


def _gen(item, api="ollama", **kwargs):
    session = _Session(item)
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
    assert call["json"]["options"] == {"temperature": 0.3, "num_predict": 400}


def test_openai_호환_형식으로_부르고_내용을_꺼낸다():
    gen, session = _gen(
        _Response(200, {"choices": [{"message": {"content": "좋아요."}}]}), api="openai"
    )

    assert gen("s", "u") == "좋아요."
    call = session.calls[0]
    assert call["url"] == "http://127.0.0.1:11434/v1/chat/completions"
    assert call["json"]["max_tokens"] == 400 and call["json"]["temperature"] == 0.3


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
