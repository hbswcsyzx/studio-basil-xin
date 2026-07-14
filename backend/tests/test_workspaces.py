import base64
import io

from fastapi.testclient import TestClient
from PIL import Image


def png_bytes(color=(220, 40, 40)) -> bytes:
    image = Image.new("RGB", (32, 18), color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_workspace_lifecycle_and_quota(client: TestClient, register):
    register()
    created = client.post("/api/workspaces", json={"name": "Concept 01"})
    assert created.status_code == 201
    workspace = created.json()
    assert workspace["image_count"] == 0

    renamed = client.patch(
        f"/api/workspaces/{workspace['id']}", json={"name": "Snow training"}
    )
    assert renamed.json()["name"] == "Snow training"
    assert client.get("/api/quota").json() == {"used": 0, "limit": 1000}


def test_asset_download_and_delete_release_quota(client: TestClient, register):
    register()
    workspace = client.post("/api/workspaces", json={"name": "W"}).json()
    asset = client.app.state.assets.save_generated(
        user_id=workspace["user_id"],
        workspace_id=workspace["id"],
        run_id=None,
        content=png_bytes(),
        mime_type="image/png",
    )

    assert client.get("/api/quota").json()["used"] == 1
    download = client.get(f"/api/assets/{asset['id']}/download")
    assert download.status_code == 200
    assert download.content.startswith(b"\x89PNG")
    assert "attachment" in download.headers["content-disposition"]

    assert client.delete(f"/api/assets/{asset['id']}").status_code == 204
    assert client.get("/api/quota").json()["used"] == 0


def test_workspace_delete_removes_owned_files(client: TestClient, register):
    register()
    workspace = client.post("/api/workspaces", json={"name": "W"}).json()
    asset = client.app.state.assets.save_generated(
        user_id=workspace["user_id"],
        workspace_id=workspace["id"],
        run_id=None,
        content=png_bytes(),
        mime_type="image/png",
    )
    path = client.app.state.settings.storage_path / asset["path"]
    assert path.exists()
    assert client.delete(f"/api/workspaces/{workspace['id']}").status_code == 204
    assert not path.exists()

