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
        self.session = session or requests.Session()

    def __call__(self, system: str, user: str) -> str:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        if self.api == API_OLLAMA:
            url = f"{self.base_url}/api/chat"
            body: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "stream": False,
                "options": {"temperature": self.temperature, "num_predict": self.max_tokens},
            }
        else:
            url = f"{self.base_url}/v1/chat/completions"
            body = {
                "model": self.model,
                "messages": messages,
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
            }
        try:
            response = self.session.post(url, json=body, timeout=self.timeout_sec)
        except (requests.ConnectionError, requests.Timeout) as exc:
            raise GeneratorError(f"모델 서버에 닿지 못함: {type(exc).__name__}") from exc
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
        if not isinstance(text, str):
            raise GeneratorError("모델 서버 응답 모양이 다름")
        return text
