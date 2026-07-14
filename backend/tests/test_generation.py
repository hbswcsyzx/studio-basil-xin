import base64
import io

from fastapi.testclient import TestClient
from PIL import Image


def make_png() -> bytes:
    image = Image.new("RGB", (64, 36), (40, 110, 190))
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def setup_provider_and_workspace(client: TestClient, register):
    register()
    provider = client.post(
        "/api/providers",
        json={"name": "Test", "base_url": "https://up.example", "api_key": "key"},
    ).json()
    workspace = client.post("/api/workspaces", json={"name": "Session"}).json()
    return provider, workspace


def test_text_generation_persists_b64_output(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    payloads = []

    def fake_generate(**kwargs):
        payloads.append(kwargs)
        return [{"bytes": make_png(), "mime_type": "image/png"}]

    monkeypatch.setattr("image_studio.generation.generate_images", fake_generate)
    response = client.post(
        f"/api/workspaces/{workspace['id']}/generate",
        data={
            "provider_id": provider["id"],
            "model": "gpt-image-2",
            "prompt": "A blue circle",
            "size": "2048x1152",
            "quality": "high",
            "count": "1",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["assets"][0]["width"] == 64
    assert payloads[0]["reference_images"] == []
    assert client.get("/api/quota").json()["used"] == 1


def test_reference_upload_selects_edit_path(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    seen = []

    def fake_generate(**kwargs):
        seen.append(kwargs)
        return [{"bytes": make_png(), "mime_type": "image/png"}]

    monkeypatch.setattr("image_studio.generation.generate_images", fake_generate)
    response = client.post(
        f"/api/workspaces/{workspace['id']}/generate",
        data={
            "provider_id": provider["id"],
            "model": "gpt-image-2",
            "prompt": "Match the subject",
            "size": "1536x1024",
            "quality": "high",
            "count": "1",
        },
        files=[("references", ("reference.png", make_png(), "image/png"))],
    )
    assert response.status_code == 201
    assert len(seen[0]["reference_images"]) == 1


def test_prompt_optimization_is_explicit(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    monkeypatch.setattr(
        "image_studio.generation.optimize_prompt",
        lambda **kwargs: "A precise cinematic blue circle prompt",
    )
    response = client.post(
        f"/api/workspaces/{workspace['id']}/optimize",
        json={
            "provider_id": provider["id"],
            "model": "gpt-5.4-mini",
            "prompt": "blue circle",
        },
    )
    assert response.status_code == 200
    assert response.json()["suggestion"].startswith("A precise")


def test_quota_blocks_generation(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    monkeypatch.setattr(client.app.state.assets, "quota", lambda _user_id: (1000, 1000))
    response = client.post(
        f"/api/workspaces/{workspace['id']}/generate",
        data={
            "provider_id": provider["id"],
            "model": "gpt-image-2",
            "prompt": "test",
            "size": "1024x1024",
            "quality": "high",
            "count": "1",
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "quota_exceeded"

