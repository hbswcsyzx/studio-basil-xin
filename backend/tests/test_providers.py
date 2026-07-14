from fastapi.testclient import TestClient


def test_provider_key_is_encrypted_and_never_returned(client: TestClient, register):
    register()
    created = client.post(
        "/api/providers",
        json={
            "name": "Basil",
            "base_url": "https://basil.xin/",
            "api_key": "sk-secret-value",
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["base_url"] == "https://basil.xin"
    assert body["has_api_key"] is True
    assert "api_key" not in body

    db_bytes = open(client.app.state.settings.database_path, "rb").read()
    assert b"sk-secret-value" not in db_bytes


def test_provider_list_is_user_scoped(client: TestClient, register):
    register("alice")
    client.post(
        "/api/providers",
        json={"name": "A", "base_url": "https://a.example", "api_key": "key-a"},
    )
    client.post("/api/auth/logout")
    register("bob")
    assert client.get("/api/providers").json() == []


def test_model_refresh_uses_openai_models_endpoint(
    client: TestClient, register, monkeypatch
):
    register()
    provider = client.post(
        "/api/providers",
        json={
            "name": "Gateway",
            "base_url": "https://gateway.example/v1",
            "api_key": "secret",
        },
    ).json()

    calls = []

    def fake_fetch(base_url: str, api_key: str):
        calls.append((base_url, api_key))
        return ["gpt-image-2", "gpt-5.4-mini"]

    monkeypatch.setattr("image_studio.providers.fetch_models", fake_fetch)
    response = client.post(f"/api/providers/{provider['id']}/models")
    assert response.status_code == 200
    assert response.json()["models"] == ["gpt-5.4-mini", "gpt-image-2"]
    assert calls == [("https://gateway.example/v1", "secret")]

