import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from image_studio.generation import canvas_prompt, conform_image_to_size, validate_output_size


def make_png() -> bytes:
    image = Image.new("RGB", (64, 36), (40, 110, 190))
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def test_canvas_requirement_is_independent_from_the_user_prompt():
    prompt = canvas_prompt("A dog in watercolor style", "2048x1152")

    assert prompt.startswith("A dog in watercolor style")
    assert "2048x1152" in prompt
    assert "16:9" in prompt
    assert "独立于风格" in prompt


def test_mismatched_upstream_image_is_contained_in_exact_requested_canvas():
    content, mime_type, original_size = conform_image_to_size(
        make_png(),
        mime_type="image/png",
        size="128x128",
        background="transparent",
        output_format="png",
        output_compression=100,
    )

    with Image.open(io.BytesIO(content)) as image:
        assert image.size == (128, 128)
        assert image.mode == "RGBA"
    assert mime_type == "image/png"
    assert original_size == (64, 36)


def test_gpt_image_2_custom_size_constraints_are_validated():
    assert validate_output_size("3840x2160") == (3840, 2160)
    for invalid in ("4096x2160", "1600x900", "3840x3840", "1024x256"):
        try:
            validate_output_size(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{invalid} should be rejected")


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
            "background": "transparent",
            "output_format": "webp",
            "output_compression": "82",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["assets"][0]["width"] == 64
    assert payloads[0]["reference_images"] == []
    assert payloads[0]["background"] == "transparent"
    assert payloads[0]["output_format"] == "webp"
    assert payloads[0]["output_compression"] == 82
    assert response.json()["params"]["background"] == "transparent"
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


def test_generated_asset_can_be_cited_as_an_edit_reference(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    user_id = client.get("/api/auth/me").json()["id"]
    source_bytes = make_png()
    source = client.app.state.assets.save_generated(
        user_id=user_id,
        workspace_id=workspace["id"],
        run_id=None,
        content=source_bytes,
        mime_type="image/png",
    )
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
            "prompt": "Keep everything else unchanged and soften the expression",
            "reference_asset_ids": source["id"],
        },
    )

    assert response.status_code == 201, response.text
    assert seen[0]["reference_images"] == [(f"asset-{source['id']}.png", source_bytes, "image/png")]
    assert response.json()["params"]["reference_asset_ids"] == [source["id"]]
    assert response.json()["params"]["reference_count"] == 1


def test_cited_asset_must_belong_to_current_user(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    user_id = client.get("/api/auth/me").json()["id"]
    source = client.app.state.assets.save_generated(
        user_id=user_id,
        workspace_id=workspace["id"],
        run_id=None,
        content=make_png(),
        mime_type="image/png",
    )
    client.post("/api/auth/logout")
    register("bob", "correct horse battery")
    bob_provider = client.post(
        "/api/providers",
        json={"name": "Bob", "base_url": "https://up.example", "api_key": "key"},
    ).json()
    bob_workspace = client.post("/api/workspaces", json={"name": "Bob session"}).json()

    response = client.post(
        f"/api/workspaces/{bob_workspace['id']}/generate",
        data={
            "provider_id": bob_provider["id"],
            "model": "gpt-image-2",
            "prompt": "Try to cite another user's image",
            "reference_asset_ids": source["id"],
        },
    )

    assert response.status_code == 404


def test_uploaded_and_cited_references_share_four_image_limit(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    user_id = client.get("/api/auth/me").json()["id"]
    source = client.app.state.assets.save_generated(
        user_id=user_id,
        workspace_id=workspace["id"],
        run_id=None,
        content=make_png(),
        mime_type="image/png",
    )

    response = client.post(
        f"/api/workspaces/{workspace['id']}/generate",
        data={
            "provider_id": provider["id"],
            "model": "gpt-image-2",
            "prompt": "Too many references",
            "reference_asset_ids": source["id"],
        },
        files=[
            ("references", (f"reference-{index}.png", make_png(), "image/png"))
            for index in range(4)
        ],
    )

    assert response.status_code == 422


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


def test_failed_generation_is_visible_in_run_history(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)

    def fail_generate(**_kwargs):
        raise RuntimeError("上游请求失败 (524)")

    monkeypatch.setattr("image_studio.generation.generate_images", fail_generate)
    response = client.post(
        f"/api/workspaces/{workspace['id']}/generate",
        data={
            "provider_id": provider["id"],
            "model": "gpt-image-2",
            "prompt": "retry me",
            "size": "1408x896",
            "quality": "medium",
            "count": "1",
        },
    )
    assert response.status_code == 502
    run = client.get(f"/api/workspaces/{workspace['id']}").json()["runs"][0]
    assert run["status"] == "failed"
    assert run["error"] == "上游请求失败 (524)"
    assert run["params"]["size"] == "1408x896"
