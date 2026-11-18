"""AI 서버 진입점.

실행: uvicorn ssaplash_ai.server.app:app --host 0.0.0.0 --port 8000

서버는 내부 네트워크에서만 접근한다(외부 포트를 열지 않는다). BE가 호출한다.
기능 라우터는 이 패키지(server/) 아래에 파일을 늘려 app에 등록한다.
"""

from fastapi import FastAPI

from ssaplash_ai.server.sheet import router as sheet_router
from ssaplash_ai.server.weak_segments import router as weak_segments_router

app = FastAPI(title="SSAPLASH AI")
app.include_router(weak_segments_router)
app.include_router(sheet_router)


@app.get("/health")
def health() -> dict[str, str]:
    """컨테이너 상태 확인용. 앱이 요청을 받을 수 있으면 ok."""
    return {"status": "ok"}
