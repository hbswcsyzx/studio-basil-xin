import io
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from PIL import Image

from .auth import get_current_user


router = APIRouter(prefix="/api/assets", tags=["assets"])


class AssetService:
    def __init__(self, db, storage_path: Path):
        self.db = db
        self.storage_path = storage_path
        self.storage_path.mkdir(parents=True, exist_ok=True)

    def _safe_path(self, relative: str) -> Path:
        path = (self.storage_path / relative).resolve()
        if self.storage_path.resolve() not in path.parents:
            raise ValueError("Invalid storage path")
        return path

    def quota(self, user_id: str) -> tuple[int, int]:
        with self.db.connect() as connection:
            used = connection.execute(
                "SELECT COUNT(*) FROM assets WHERE user_id=? AND kind='generated'", (user_id,)
            ).fetchone()[0]
        return used, 1000

    def save_generated(
        self,
        user_id: str,
        workspace_id: str,
        run_id: str | None,
        content: bytes,
        mime_type: str,
    ) -> dict:
        try:
            with Image.open(io.BytesIO(content)) as image:
                width, height = image.size
                image.verify()
        except Exception as exc:
            raise ValueError("Upstream returned an invalid image") from exc
        extension = {"image/jpeg": ".jpg", "image/webp": ".webp"}.get(mime_type, ".png")
        asset_id = str(uuid.uuid4())
        relative = Path(user_id) / workspace_id / f"{asset_id}{extension}"
        path = self._safe_path(relative.as_posix())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        with self.db.connect() as connection:
            connection.execute(
                """INSERT INTO assets(id,user_id,workspace_id,run_id,kind,path,mime_type,width,height,size_bytes)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    asset_id,
                    user_id,
                    workspace_id,
                    run_id,
                    "generated",
                    relative.as_posix(),
                    mime_type,
                    width,
                    height,
                    len(content),
                ),
            )
        return self.get(asset_id, user_id)

    def get(self, asset_id: str, user_id: str) -> dict | None:
        with self.db.connect() as connection:
            row = connection.execute(
                "SELECT * FROM assets WHERE id=? AND user_id=?", (asset_id, user_id)
            ).fetchone()
        return serialize_asset(row) if row else None

    def delete(self, asset_id: str, user_id: str) -> bool:
        asset = self.get(asset_id, user_id)
        if not asset:
            return False
        self._safe_path(asset["path"]).unlink(missing_ok=True)
        with self.db.connect() as connection:
            connection.execute("DELETE FROM assets WHERE id=? AND user_id=?", (asset_id, user_id))
        return True

    def delete_workspace_files(self, user_id: str, workspace_id: str) -> None:
        directory = self._safe_path((Path(user_id) / workspace_id).as_posix())
        if directory.exists():
            shutil.rmtree(directory)


def serialize_asset(row) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "run_id": row["run_id"],
        "kind": row["kind"],
        "path": row["path"],
        "mime_type": row["mime_type"],
        "width": row["width"],
        "height": row["height"],
        "size_bytes": row["size_bytes"],
        "created_at": row["created_at"],
        "content_url": f"/api/assets/{row['id']}/content",
        "download_url": f"/api/assets/{row['id']}/download",
    }


def owned_asset(request: Request, asset_id: str, user_id: str):
    asset = request.app.state.assets.get(asset_id, user_id)
    if not asset:
        raise HTTPException(status_code=404, detail="图片不存在")
    return asset


@router.get("/{asset_id}/content")
def content(asset_id: str, request: Request, user=Depends(get_current_user)):
    asset = owned_asset(request, asset_id, user["id"])
    return FileResponse(request.app.state.assets._safe_path(asset["path"]), media_type=asset["mime_type"])


@router.get("/{asset_id}/download")
def download(asset_id: str, request: Request, user=Depends(get_current_user)):
    asset = owned_asset(request, asset_id, user["id"])
    extension = Path(asset["path"]).suffix
    return FileResponse(
        request.app.state.assets._safe_path(asset["path"]),
        media_type=asset["mime_type"],
        filename=f"studio-{asset_id}{extension}",
    )


@router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: str, request: Request, user=Depends(get_current_user)):
    if not request.app.state.assets.delete(asset_id, user["id"]):
        raise HTTPException(status_code=404, detail="图片不存在")

