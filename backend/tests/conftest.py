import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STUDIO_DATABASE_PATH", str(tmp_path / "studio.db"))
    monkeypatch.setenv("STUDIO_STORAGE_PATH", str(tmp_path / "storage"))
    monkeypatch.setenv("STUDIO_SECRET_KEY", "test-session-secret")
    monkeypatch.setenv(
        "STUDIO_ENCRYPTION_KEY",
        "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    )
    monkeypatch.setenv("STUDIO_COOKIE_SECURE", "false")

    from image_studio.main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def register(client: TestClient):
    def _register(username: str = "alice", password: str = "correct horse battery"):
        response = client.post(
            "/api/auth/register",
            json={"username": username, "password": password},
        )
        assert response.status_code == 201, response.text
        return response

    return _register
