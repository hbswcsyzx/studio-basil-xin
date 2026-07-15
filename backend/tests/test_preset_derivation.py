import base64
import io
import json
import uuid

import httpx
from fastapi.testclient import TestClient
from PIL import Image

from image_studio.preset_derivation import (
    build_conversation_evidence,
    request_preset_drafts,
    select_representative_assets,
)


def make_png(color: tuple[int, int, int]) -> bytes:
    image = Image.new("RGB", (80, 48), color)
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def create_workspace(client: TestClient, register):
    register()
    return client.post("/api/workspaces", json={"name": "Current conversation"}).json()


def insert_run(client: TestClient, workspace_id: str, *, prompt: str, params: dict, status: str = "completed"):
    user_id = client.get("/api/auth/me").json()["id"]
    run_id = str(uuid.uuid4())
    with client.app.state.db.connect() as connection:
        connection.execute(
            """INSERT INTO runs(id,user_id,workspace_id,model,prompt,params_json,status)
               VALUES(?,?,?,?,?,?,?)""",
            (run_id, user_id, workspace_id, "gpt-image-2", prompt, json.dumps(params), status),
        )
    return run_id, user_id


def add_asset(client: TestClient, workspace_id: str, run_id: str, user_id: str, color=(30, 80, 140)):
    return client.app.state.assets.save_generated(
        user_id=user_id,
        workspace_id=workspace_id,
        run_id=run_id,
        content=make_png(color),
        mime_type="image/png",
    )


def valid_drafts():
    return {
        "summary": "用户偏好克制的电影感人物插画，并持续收紧面部表达。",
        "style_draft": {
            "name": "克制电影人物",
            "prompt": "保持真实材质、明确主光与克制色彩，人物表情和轮廓优先，背景服务于主体。",
            "confidence": 0.86,
            "accepted": ["真实材质", "克制色彩"],
            "changes": ["面部表情需要更严厉"],
            "uncertain": ["是否长期偏好雪山背景"],
        },
        "image_draft": {
            "name": "横向高质量",
            "size": "2048x1152",
            "quality": "high",
            "count": 1,
            "background": "auto",
            "output_format": "png",
            "output_compression": 100,
            "confidence": 0.78,
            "accepted": ["横向构图"],
            "changes": [],
            "uncertain": ["数量样本不足"],
        },
    }


def test_builds_current_conversation_refinement_evidence(client: TestClient, register):
    workspace = create_workspace(client, register)
    first_id, user_id = insert_run(
        client,
        workspace["id"],
        prompt="冷色调电影人物插画",
        params={"size": "2048x1152", "quality": "high", "reference_asset_ids": []},
    )
    first_asset = add_asset(client, workspace["id"], first_id, user_id)
    client.patch(f"/api/assets/{first_asset['id']}", json={"favorite": True})

    delta = "保持构图，只把人物面部改得更严厉"
    second_id, _ = insert_run(
        client,
        workspace["id"],
        prompt=delta,
        params={
            "size": "2048x1152",
            "quality": "high",
            "reference_asset_ids": [first_asset["id"]],
        },
    )
    second_asset = add_asset(client, workspace["id"], second_id, user_id, (90, 40, 50))
    insert_run(client, workspace["id"], prompt="上游超时", params={}, status="failed")

    evidence = build_conversation_evidence(client.app, workspace["id"], user_id)

    assert evidence["statistics"]["successful_runs"] == 2
    assert evidence["statistics"]["failed_runs_excluded"] == 1
    assert evidence["chains"][0]["changes"] == [delta]
    assert evidence["runs"][1]["is_terminal"] is True
    assert all(run["status"] == "completed" for run in evidence["runs"])
    representatives = select_representative_assets(evidence)
    assert {item["id"] for item in representatives} == {first_asset["id"], second_asset["id"]}
    assert len({item["id"] for item in representatives}) == len(representatives) <= 6


def test_derivation_requires_a_successful_run(client: TestClient, register):
    workspace = create_workspace(client, register)
    insert_run(client, workspace["id"], prompt="失败记录", params={}, status="failed")

    response = client.post(f"/api/workspaces/{workspace['id']}/derive-presets")

    assert response.status_code == 422
    assert "成功" in response.json()["detail"]


def test_endpoint_uses_default_text_model_without_mutating_preferences(
    client: TestClient, register, monkeypatch
):
    workspace = create_workspace(client, register)
    provider = client.post(
        "/api/providers",
        json={"name": "Text", "base_url": "https://up.example", "api_key": "key"},
    ).json()
    client.patch(
        "/api/auth/preferences",
        json={"default_text_provider_id": provider["id"], "default_text_model": "gpt-5.5"},
    )
    run_id, user_id = insert_run(
        client,
        workspace["id"],
        prompt="人物卡牌插画",
        params={"size": "1024x1536", "quality": "high"},
    )
    add_asset(client, workspace["id"], run_id, user_id)
    seen = {}

    def fake_request(**kwargs):
        seen.update(kwargs)
        return {"drafts": valid_drafts(), "used_visual_analysis": True, "fallback_reason": None}

    monkeypatch.setattr("image_studio.preset_derivation.request_preset_drafts", fake_request)
    before = client.get("/api/auth/me").json()["preferences"]

    response = client.post(f"/api/workspaces/{workspace['id']}/derive-presets")

    assert response.status_code == 200, response.text
    assert seen["model"] == "gpt-5.5"
    assert seen["base_url"] == "https://up.example"
    assert seen["images"]
    assert response.json()["statistics"]["successful_runs"] == 1
    assert response.json()["used_visual_analysis"] is True
    assert client.get("/api/auth/me").json()["preferences"] == before


def test_responses_image_rejection_falls_back_once_to_prompt_only(monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload
            self.request = httpx.Request("POST", "https://up.example/v1/responses")
            self.text = json.dumps(payload)

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError("rejected", request=self.request, response=self)

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, _url, **kwargs):
            calls.append(kwargs["json"])
            if len(calls) == 1:
                return FakeResponse(400, {"error": "image input unsupported"})
            encoded = base64.b64encode(json.dumps(valid_drafts()).encode()).decode()
            return FakeResponse(200, {"output_text": base64.b64decode(encoded).decode()})

    monkeypatch.setattr("image_studio.preset_derivation.httpx.Client", FakeClient)

    result = request_preset_drafts(
        base_url="https://up.example",
        api_key="key",
        model="gpt-5.5",
        evidence={"runs": [], "chains": [], "statistics": {}},
        images=["data:image/jpeg;base64,AAAA"],
    )

    assert len(calls) == 2
    assert any(item.get("type") == "input_image" for item in calls[0]["input"][0]["content"])
    assert all(item.get("type") != "input_image" for item in calls[1]["input"][0]["content"])
    assert result["used_visual_analysis"] is False
    assert "图片" in result["fallback_reason"]
