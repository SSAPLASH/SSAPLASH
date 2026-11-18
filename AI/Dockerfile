# AI 서버 이미지. Python 3.11 + uv, 비루트 사용자, extra(torch 등) 없이 기본 의존성만 설치한다.
# 모델 파일·학습 데이터는 이미지에 넣지 않는다(.dockerignore). 모델은 MLflow·/models 경로로 전달한다.

# ---- 1단계: 의존성 설치 ----
FROM python:3.11-slim AS builder

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

# uv는 빌드에만 쓰고 최종 이미지에는 넣지 않는다.
RUN pip install --no-cache-dir uv==0.12.5

WORKDIR /app

# 의존성만 먼저 설치한다. 소스가 바뀌어도 이 층은 다시 만들어지지 않는다.
COPY pyproject.toml uv.lock .python-version README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# 소스를 넣고 프로젝트를 설치한다.
COPY src ./src
# 서비스 설정(채보 변환 등). AI 서버가 /app에서 configs/…를 상대 경로로 읽는다(S15P31A307-293)
COPY configs ./configs
RUN uv sync --frozen --no-dev

# ---- 2단계: 실행 이미지 ----
FROM python:3.11-slim

# 오디오 읽기(libsndfile)와 수치 라이브러리(libgomp)가 쓰는 시스템 라이브러리
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 비루트 사용자로 실행한다.
RUN useradd --create-home --uid 10001 app

WORKDIR /app
COPY --from=builder /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER app
EXPOSE 8000

# 컨테이너 안에서만 확인한다(curl이 없어 파이썬으로 호출).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

CMD ["uvicorn", "ssaplash_ai.server.app:app", "--host", "0.0.0.0", "--port", "8000"]
