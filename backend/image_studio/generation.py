import base64
import json
import uuid

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel

from .auth import get_current_user
from .providers import api_endpoint, owned_provider
from .security import decrypt_secret
from .workspaces import owned_workspace


router = APIRouter(tags=["generation"])


class OptimizeInput(BaseModel):
    provider_id: str
    model: str
    prompt: str


def generate_images(
    *, base_url: str, api_key: str, model: str, prompt: str, size: str,
    quality: str, count: int, reference_images: list[tuple[str, bytes, str]]
) -> list[dict]:
    headers = {"Authorization": f"Bearer {api_key}"}
    timeout = httpx.Timeout(480.0, connect=30.0)
    try:
        with httpx.Client(timeout=timeout, trust_env=False) as client:
            if reference_images:
                files = [("image[]", (name, content, mime)) for name, content, mime in reference_images]
                data = {"model": model, "prompt": prompt, "size": size, "quality": quality, "n": str(count)}
                response = client.post(api_endpoint(base_url, "images/edits"), headers=headers, data=data, files=files)
            else:
                response = client.post(
                    api_endpoint(base_url, "images/generations"), headers={**headers, "Content-Type": "application/json"},
                    json={"model": model, "prompt": prompt, "size": size, "quality": quality, "n": count},
                )
            response.raise_for_status()
            items = []
            for item in response.json().get("data", []):
                if item.get("b64_json"):
                    content = base64.b64decode(item["b64_json"])
                    mime = "image/png"
                elif item.get("url"):
                    downloaded = client.get(item["url"])
                    downloaded.raise_for_status()
                    content = downloaded.content
                    mime = downloaded.headers.get("content-type", "image/png").split(";")[0]
                else:
                    continue
                items.append({"bytes": content, "mime_type": mime})
            if not items:
                raise ValueError("上游没有返回图片数据")
            return items
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:600]
        raise RuntimeError(f"上游请求失败 ({exc.response.status_code})：{detail}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"无法连接上游：{exc}") from exc


def optimize_prompt(*, base_url: str, api_key: str, model: str, prompt: str) -> str:
    try:
        with httpx.Client(trust_env=False, timeout=90) as client:
            response = client.post(
                api_endpoint(base_url, "responses"),
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "instructions": "Improve the user's image-generation prompt. Preserve intent, add only useful visual specificity, and return only the revised prompt in the user's language.",
                    "input": prompt,
                },
            )
        response.raise_for_status()
        payload = response.json()
        if payload.get("output_text"):
            return payload["output_text"].strip()
        for output in payload.get("output", []):
            for content in output.get("content", []):
                if content.get("text"):
                    return content["text"].strip()
        raise ValueError("上游没有返回建议")
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError(f"提示词优化失败：{exc}") from exc


@router.post("/api/workspaces/{workspace_id}/generate", status_code=status.HTTP_201_CREATED)
async def generate(
    workspace_id: str,
    request: Request,
    provider_id: str = Form(...),
    model: str = Form(...),
    prompt: str = Form(...),
    size: str = Form("1024x1024"),
    quality: str = Form("high"),
    count: int = Form(1),
    references: list[UploadFile] = File(default=[]),
    user=Depends(get_current_user),
):
    owned_workspace(request, workspace_id, user["id"])
    provider = owned_provider(request, provider_id, user["id"])
    used, limit = request.app.state.assets.quota(user["id"])
    if count < 1 or count > 4:
        raise HTTPException(status_code=422, detail="每次可生成 1-4 张图片")
    if used + count > limit:
        raise HTTPException(status_code=409, detail={"code": "quota_exceeded", "used": used, "limit": limit})
    if not prompt.strip():
        raise HTTPException(status_code=422, detail="请输入提示词")

    reference_images = []
    for upload in references[:4]:
        content = await upload.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="单张参考图不能超过 20MB")
        reference_images.append((upload.filename or "reference.png", content, upload.content_type or "image/png"))

    run_id = str(uuid.uuid4())
    params = {"size": size, "quality": quality, "count": count, "reference_count": len(reference_images)}
    with request.app.state.db.connect() as connection:
        connection.execute(
            """INSERT INTO runs(id,user_id,workspace_id,provider_id,model,prompt,params_json,status)
               VALUES(?,?,?,?,?,?,?,'running')""",
            (run_id, user["id"], workspace_id, provider_id, model, prompt.strip(), json.dumps(params)),
        )
    api_key = decrypt_secret(request.app.state.settings.encryption_key, provider["api_key_encrypted"])
    try:
        outputs = generate_images(
            base_url=provider["base_url"], api_key=api_key, model=model, prompt=prompt.strip(),
            size=size, quality=quality, count=count, reference_images=reference_images,
        )
        assets = [
            request.app.state.assets.save_generated(
                user_id=user["id"], workspace_id=workspace_id, run_id=run_id,
                content=output["bytes"], mime_type=output["mime_type"],
            )
            for output in outputs
        ]
        with request.app.state.db.connect() as connection:
            connection.execute("UPDATE runs SET status='completed' WHERE id=?", (run_id,))
            connection.execute("UPDATE workspaces SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (workspace_id,))
        return {"id": run_id, "prompt": prompt.strip(), "model": model, "params": params, "status": "completed", "assets": assets}
    except Exception as exc:
        with request.app.state.db.connect() as connection:
            connection.execute("UPDATE runs SET status='failed',error=? WHERE id=?", (str(exc)[:1000], run_id))
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/workspaces/{workspace_id}/optimize")
def optimize(workspace_id: str, payload: OptimizeInput, request: Request, user=Depends(get_current_user)):
    owned_workspace(request, workspace_id, user["id"])
    provider = owned_provider(request, payload.provider_id, user["id"])
    api_key = decrypt_secret(request.app.state.settings.encryption_key, provider["api_key_encrypted"])
    try:
        return {"suggestion": optimize_prompt(base_url=provider["base_url"], api_key=api_key, model=payload.model, prompt=payload.prompt)}
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
