"""AI 서버 /health 확인."""

from fastapi.testclient import TestClient

from ssaplash_ai.server.app import app


def test_health가_ok를_돌려준다():
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
