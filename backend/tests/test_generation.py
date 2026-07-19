import base64
import io
import threading

from fastapi.testclient import TestClient
from PIL import Image

from image_studio.generation import canvas_prompt, conform_image_to_size, generate_images, optimize_prompt, validate_output_size


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


def test_upstream_requests_receive_selected_size_quality_and_count(monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            encoded = base64.b64encode(make_png()).decode()
            return {"data": [{"b64_json": encoded} for _ in range(3)]}

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse()

    monkeypatch.setattr("image_studio.generation.httpx.Client", FakeClient)
    common = {
        "base_url": "https://up.example",
        "api_key": "key",
        "model": "gpt-image-2",
        "prompt": "A precise test image",
        "size": "1024x1024",
        "quality": "medium",
        "count": 3,
        "background": "auto",
        "output_format": "png",
        "output_compression": 100,
    }

    generated = generate_images(**common, reference_images=[])
    edited = generate_images(**common, reference_images=[("reference.png", make_png(), "image/png")])

    assert len(generated) == 3
    assert len(edited) == 3
    assert calls[0][0].endswith("/images/generations")
    assert calls[0][1]["json"]["size"] == "1024x1024"
    assert calls[0][1]["json"]["quality"] == "medium"
    assert calls[0][1]["json"]["n"] == 3
    assert calls[1][0].endswith("/images/edits")
    assert calls[1][1]["data"]["size"] == "1024x1024"
    assert calls[1][1]["data"]["quality"] == "medium"
    assert calls[1][1]["data"]["n"] == "3"


def test_upstream_reference_attachments_are_numbered_in_order(monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            encoded = base64.b64encode(make_png()).decode()
            return {"data": [{"b64_json": encoded}]}

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse()

    monkeypatch.setattr("image_studio.generation.httpx.Client", FakeClient)
    generate_images(
        base_url="https://up.example",
        api_key="key",
        model="gpt-image-2",
        prompt="Combine the people from reference image 1 and reference image 2",
        size="1024x1024",
        quality="high",
        count=1,
        background="auto",
        output_format="png",
        output_compression=100,
        reference_images=[
            ("person-a.png", make_png(), "image/png"),
            ("person-b.png", make_png(), "image/png"),
        ],
    )

    request = calls[0][1]
    assert [item[1][0] for item in request["files"]] == ["reference-01.png", "reference-02.png"]
    assert "参考图 1 至参考图 2" in request["data"]["prompt"]
    assert "第 N 个附件" in request["data"]["prompt"]
    assert "位置以用户文字要求为准" in request["data"]["prompt"]


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
    assert response.status_code == 202, response.text
    detail = client.get(f"/api/workspaces/{workspace['id']}").json()
    completed = next(run for run in detail["runs"] if run["id"] == response.json()["id"])
    assert completed["assets"][0]["width"] == 64
    assert payloads[0]["reference_images"] == []
    assert payloads[0]["background"] == "transparent"
    assert payloads[0]["output_format"] == "webp"
    assert payloads[0]["output_compression"] == 82
    assert response.json()["params"]["background"] == "transparent"
    assert client.get("/api/quota").json()["used"] == 1


def test_generation_work_does_not_block_the_request_event_loop(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    worker_threads = []

    def fake_generate(**_kwargs):
        worker_threads.append(threading.current_thread().name)
        return [{"bytes": make_png(), "mime_type": "image/png"}]

    monkeypatch.setattr("image_studio.generation.generate_images", fake_generate)
    response = client.post(
        f"/api/workspaces/{workspace['id']}/generate",
        data={
            "provider_id": provider["id"],
            "model": "gpt-image-2",
            "prompt": "A responsive request",
            "size": "1024x1024",
        },
    )

    assert response.status_code == 202
    assert worker_threads == ["AnyIO worker thread"]


def test_generation_is_accepted_before_background_result_is_returned(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)

    monkeypatch.setattr(
        "image_studio.generation.generate_images",
        lambda **_kwargs: [{"bytes": make_png(), "mime_type": "image/png"}],
    )

    response = client.post(
        f"/api/workspaces/{workspace['id']}/generate",
        data={
            "provider_id": provider["id"],
            "model": "gpt-image-2",
            "prompt": "Persist after the browser disconnects",
        },
    )

    assert response.status_code == 202, response.text
    assert response.json()["status"] == "running"
    assert response.json()["assets"] == []

    detail = client.get(f"/api/workspaces/{workspace['id']}").json()
    completed = next(run for run in detail["runs"] if run["id"] == response.json()["id"])
    assert completed["status"] == "completed"
    assert len(completed["assets"]) == 1


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
    assert response.status_code == 202
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

    assert response.status_code == 202, response.text
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


def test_uploaded_and_cited_references_share_ten_image_limit(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    user_id = client.get("/api/auth/me").json()["id"]
    source = client.app.state.assets.save_generated(
        user_id=user_id,
        workspace_id=workspace["id"],
        run_id=None,
        content=make_png(),
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
            "prompt": "Ten references are allowed",
            "reference_asset_ids": source["id"],
        },
        files=[
            ("references", (f"reference-{index}.png", make_png(), "image/png"))
            for index in range(9)
        ],
    )

    assert response.status_code == 202, response.text
    assert len(seen[0]["reference_images"]) == 10

    response = client.post(
        f"/api/workspaces/{workspace['id']}/generate",
        data={
            "provider_id": provider["id"],
            "model": "gpt-image-2",
            "prompt": "Eleven references are rejected",
            "reference_asset_ids": source["id"],
        },
        files=[
            ("references", (f"reference-{index}.png", make_png(), "image/png"))
            for index in range(10)
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


def test_prompt_optimization_sends_style_settings_and_reference_images(monkeypatch):
    calls = []

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"output": [{"type": "message", "content": [{"type": "output_text", "text": "润色后的完整提示词"}]}]}

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, _url, **kwargs):
            calls.append(kwargs["json"])
            return FakeResponse()

    monkeypatch.setattr("image_studio.generation.httpx.Client", FakeClient)

    result = optimize_prompt(
        base_url="https://up.example",
        api_key="key",
        model="gpt-5.5",
        prompt="画一个角色",
        style_prompt="冷色电影感",
        settings={"size": "2048x1152", "quality": "high"},
        reference_images=[("reference.png", make_png(), "image/png")],
    )

    assert result == "润色后的完整提示词"
    payload = calls[0]
    assert payload["max_output_tokens"] == 2048
    assert payload["reasoning"] == {"effort": "low"}
    content = payload["input"][0]["content"]
    assert "冷色电影感" in content[0]["text"]
    assert "2048x1152" in content[0]["text"]
    assert content[1]["type"] == "input_image"
    assert content[1]["image_url"].startswith("data:image/jpeg;base64,")


def test_prompt_optimization_endpoint_accepts_rich_multipart_context(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    seen = {}

    def fake_optimize(**kwargs):
        seen.update(kwargs)
        return "润色后的提示词"

    monkeypatch.setattr("image_studio.generation.optimize_prompt", fake_optimize)
    response = client.post(
        f"/api/workspaces/{workspace['id']}/optimize",
        data={
            "provider_id": provider["id"], "model": "gpt-5.5", "prompt": "画一个角色",
            "style_prompt": "冷色电影感", "size": "2048x1152", "quality": "high", "count": "2",
        },
        files=[("references", ("reference.png", make_png(), "image/png"))],
    )

    assert response.status_code == 200, response.text
    assert response.json()["suggestion"] == "润色后的提示词"
    assert seen["style_prompt"] == "冷色电影感"
    assert seen["settings"]["size"] == "2048x1152"
    assert len(seen["reference_images"]) == 1


def test_prompt_optimization_rejects_image_model_before_upstream(client: TestClient, register, monkeypatch):
    provider, workspace = setup_provider_and_workspace(client, register)
    monkeypatch.setattr(
        "image_studio.generation.optimize_prompt",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("image model reached upstream")),
    )

    response = client.post(
        f"/api/workspaces/{workspace['id']}/optimize",
        json={
            "provider_id": provider["id"],
            "model": "seedream-5.0",
            "prompt": "blue circle",
        },
    )

    assert response.status_code == 422
    assert "图片模型" in response.json()["detail"]


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
    assert response.status_code == 202
    run = client.get(f"/api/workspaces/{workspace['id']}").json()["runs"][0]
    assert run["status"] == "failed"
    assert run["error"] == "上游请求失败 (524)"
    assert run["params"]["size"] == "1408x896"
