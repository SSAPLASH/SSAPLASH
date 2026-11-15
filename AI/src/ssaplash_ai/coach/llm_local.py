"""같은 GPU 서버에서 도는 로컬 모델 서버를 부르는 생성기 (설계 v0.6, 비용 0).

모델을 이 프로세스에 올리지 않는다. Ollama 또는 OpenAI 호환 서버(vLLM, llama.cpp 서버 등)가 모델을 들고 있고,
여기서는 문장을 달라고 HTTP로 부탁만 한다. 그래서 새 파이썬 의존성이 없고(`requests`만) 모델을 바꿀 때 이 코드를
건드리지 않는다. 외부 서비스·유료 API는 부르지 않으며 주소는 같은 서버(127.0.0.1)가 기본이다.

`narrative.write_narrative`가 요구하는 모양 `(system, user) -> str`로 부를 수 있다.
"""

from __future__ import annotations

from typing import Any

import requests

API_OLLAMA = "ollama"
API_OPENAI = "openai"
SUPPORTED_APIS = (API_OLLAMA, API_OPENAI)
# 프롬프트(수백 토큰)와 답(400토큰 이하)이 들어가면 충분하다
DEFAULT_NUM_CTX = 4096


class GeneratorError(Exception):
    """모델 서버에 닿지 못했거나 응답이 이상함. 다시 시도해 봐야 같은 환경 문제일 수 있다."""


class LocalServerGenerator:
    def __init__(
        self,
        base_url: str,
        model: str,
        api: str = API_OLLAMA,
        timeout_sec: float = 60.0,
        temperature: float = 0.3,
        max_tokens: int = 400,
        num_ctx: int = DEFAULT_NUM_CTX,
        think: bool | None = False,
        json_output: bool = False,
        session: requests.Session | None = None,
    ) -> None:
        if api not in SUPPORTED_APIS:
            raise ValueError(f"지원하지 않는 모델 서버 형식: {api!r} (ollama, openai)")
        if not model.strip():
            raise ValueError("모델 이름이 비어 있음")
        self.base_url = base_url.rstrip("/")
        self.model = model.strip()
        self.api = api
        self.timeout_sec = timeout_sec
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.num_ctx = num_ctx
        # 생각(추론) 모드를 끈다. 켜 두면 최신 모델이 토큰 상한을 생각에 다 써서 답이 비어 올 수 있다. None이면 보내지 않는다
        self.think = think
        # JSON 하나만 내게 한다(Ollama `format: json`). 모양만 강제하고 길이는 강제하지 않는다. 연주 중 코칭이 쓴다
        self.json_output = json_output
        self.session = session or requests.Session()

    def __call__(self, system: str, user: str) -> str:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        if self.api == API_OLLAMA:
            url = f"{self.base_url}/api/chat"
            body: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "stream": False,
                # 문맥 길이를 정해 주지 않으면 서버가 VRAM 크기에 맞춰 아주 크게(수십만 토큰) 잡아 메모리를 낭비한다
                "options": {
                    "temperature": self.temperature,
                    "num_predict": self.max_tokens,
                    "num_ctx": self.num_ctx,
                },
            }
        else:
            url = f"{self.base_url}/v1/chat/completions"
            body = {
                "model": self.model,
                "messages": messages,
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
            }
        if self.api == API_OLLAMA and self.think is not None:
            body["think"] = self.think
        if self.api == API_OLLAMA and self.json_output:
            body["format"] = "json"
        response = self._post(url, body)
        if response.status_code == 400 and "think" in body and "think" in _error_text(response):
            # 생각 모드를 모르는 모델이면 그 항목 없이 한 번 더 보낸다
            del body["think"]
            response = self._post(url, body)
        if response.status_code != 200:
            raise GeneratorError(f"모델 서버 응답 {response.status_code}")
        try:
            data = response.json()
            text = (
                data["message"]["content"]
                if self.api == API_OLLAMA
                else data["choices"][0]["message"]["content"]
            )
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise GeneratorError("모델 서버 응답 모양이 다름") from exc
        if not isinstance(text, str) or not text.strip():
            raise GeneratorError("모델 서버 응답 모양이 다름(내용이 비어 있음)")
        return text

    def _post(self, url: str, body: dict[str, Any]) -> requests.Response:
        try:
            return self.session.post(url, json=body, timeout=self.timeout_sec)
        except (requests.ConnectionError, requests.Timeout) as exc:
            raise GeneratorError(f"모델 서버에 닿지 못함: {type(exc).__name__}") from exc


def _error_text(response: requests.Response) -> str:
    return str(getattr(response, "text", "")).lower()
