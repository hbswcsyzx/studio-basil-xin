import base64
import io
import json
import math
import re
import uuid

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile, status
from PIL import Image, ImageFilter, ImageOps
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .auth import get_current_user
from .assets import owned_asset
from .providers import api_endpoint, is_image_model, owned_provider
from .security import decrypt_secret
from .workspaces import owned_workspace


router = APIRouter(tags=["generation"])
MAX_REFERENCE_IMAGES = 10


class OptimizeInput(BaseModel):
    provider_id: str
    model: str
    prompt: str


def _parse_size(size: str) -> tuple[int, int] | None:
    if size == "auto":
        return None
    match = re.fullmatch(r"(\d+)x(\d+)", size)
    if not match:
        raise ValueError("图片尺寸格式不正确")
    return int(match.group(1)), int(match.group(2))


def validate_output_size(size: str) -> tuple[int, int] | None:
    dimensions = _parse_size(size)
    if dimensions is None:
        return None
    width, height = dimensions
    pixels = width * height
    if max(width, height) > 3840:
        raise ValueError("图片边长不能超过 3840 像素")
    if width % 16 or height % 16:
        raise ValueError("图片宽高必须是 16 的倍数")
    if max(width, height) / min(width, height) > 3:
        raise ValueError("图片长短边比例不能超过 3:1")
    if pixels < 655_360 or pixels > 8_294_400:
        raise ValueError("图片总像素需在 655,360 到 8,294,400 之间")
    return dimensions


def canvas_prompt(prompt: str, size: str) -> str:
    dimensions = validate_output_size(size)
    if dimensions is None:
        return prompt
    width, height = dimensions
    divisor = math.gcd(width, height)
    ratio = f"{width // divisor}:{height // divisor}"
    orientation = "横向" if width > height else "纵向" if height > width else "方形"
    return (
        f"{prompt}\n\n"
        f"技术画布要求（独立于风格）：输出必须严格使用 {width}x{height} 像素的{orientation}画布，"
        f"宽高比 {ratio}；不得根据主体或风格改变画布方向、比例或像素尺寸。"
    )


def conform_image_to_size(
    content: bytes,
    *,
    mime_type: str,
    size: str,
    background: str,
    output_format: str,
    output_compression: int,
) -> tuple[bytes, str, tuple[int, int] | None]:
    dimensions = _parse_size(size)
    if dimensions is None:
        return content, mime_type, None
    target_width, target_height = dimensions
    with Image.open(io.BytesIO(content)) as opened:
        opened.load()
        original_size = opened.size
        if original_size == dimensions:
            return content, mime_type, original_size

        source = opened.convert("RGBA")
        contained = ImageOps.contain(source, dimensions, Image.Resampling.LANCZOS)
        x = (target_width - contained.width) // 2
        y = (target_height - contained.height) // 2
        transparent = background == "transparent" and output_format != "jpeg"
        if transparent:
            canvas = Image.new("RGBA", dimensions, (0, 0, 0, 0))
            canvas.alpha_composite(contained, (x, y))
        else:
            backdrop = ImageOps.fit(source.convert("RGB"), dimensions, Image.Resampling.LANCZOS)
            radius = max(2, round(max(dimensions) / 48))
            canvas = backdrop.filter(ImageFilter.GaussianBlur(radius=radius))
            canvas.paste(contained, (x, y), contained)

        output = io.BytesIO()
        if output_format == "jpeg":
            canvas.convert("RGB").save(output, "JPEG", quality=output_compression, optimize=True)
            normalized_mime = "image/jpeg"
        elif output_format == "webp":
            canvas.save(output, "WEBP", quality=output_compression, method=4)
            normalized_mime = "image/webp"
        else:
            canvas.save(output, "PNG", optimize=True)
            normalized_mime = "image/png"
        return output.getvalue(), normalized_mime, original_size


def _reference_extension(mime_type: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(mime_type.lower(), ".png")


def reference_order_prompt(prompt: str, count: int) -> str:
    if count <= 0:
        return prompt
    return (
        f"{prompt}\n\n"
        f"参考图按附件顺序编号为参考图 1 至参考图 {count}。"
        "用户提到‘参考图 N’时，必须对应第 N 个附件；不要交换或重新排序。"
        "主体在画面中的位置以用户文字要求为准，不能仅根据参考图编号推断。"
    )


def generate_images(
    *, base_url: str, api_key: str, model: str, prompt: str, size: str,
    quality: str, count: int, background: str, output_format: str,
    output_compression: int, reference_images: list[tuple[str, bytes, str]]
) -> list[dict]:
    headers = {"Authorization": f"Bearer {api_key}"}
    timeout = httpx.Timeout(480.0, connect=30.0)
    upstream_prompt = canvas_prompt(reference_order_prompt(prompt, len(reference_images)), size)
    try:
        with httpx.Client(timeout=timeout, trust_env=False) as client:
            if reference_images:
                files = [
                    (
                        "image[]",
                        (f"reference-{index:02d}{_reference_extension(mime)}", content, mime),
                    )
                    for index, (_name, content, mime) in enumerate(reference_images, start=1)
                ]
                data = {
                    "model": model, "prompt": upstream_prompt, "size": size, "quality": quality,
                    "n": str(count), "background": background, "output_format": output_format,
                    "output_compression": str(output_compression),
                }
                response = client.post(api_endpoint(base_url, "images/edits"), headers=headers, data=data, files=files)
            else:
                response = client.post(
                    api_endpoint(base_url, "images/generations"), headers={**headers, "Content-Type": "application/json"},
                    json={
                        "model": model, "prompt": upstream_prompt, "size": size, "quality": quality,
                        "n": count, "background": background, "output_format": output_format,
                        "output_compression": output_compression,
                    },
                )
            response.raise_for_status()
            items = []
            for item in response.json().get("data", []):
                if item.get("b64_json"):
                    content = base64.b64decode(item["b64_json"])
                    mime = {"jpeg": "image/jpeg", "webp": "image/webp"}.get(output_format, "image/png")
                elif item.get("url"):
                    downloaded = client.get(item["url"])
                    downloaded.raise_for_status()
                    content = downloaded.content
                    mime = downloaded.headers.get("content-type", "image/png").split(";")[0]
                else:
                    continue
                content, mime, upstream_size = conform_image_to_size(
                    content,
                    mime_type=mime,
                    size=size,
                    background=background,
                    output_format=output_format,
                    output_compression=output_compression,
                )
                items.append({"bytes": content, "mime_type": mime, "upstream_size": upstream_size})
            if not items:
                raise ValueError("上游没有返回图片数据")
            return items
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:600]
        raise RuntimeError(f"上游请求失败 ({exc.response.status_code})：{detail}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"无法连接上游：{exc}") from exc


def _responses_text(payload: dict) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    output_types = []
    for output in payload.get("output", []):
        if not isinstance(output, dict):
            continue
        output_types.append(str(output.get("type", "unknown")))
        for content in output.get("content", []):
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
            if isinstance(text, dict) and isinstance(text.get("value"), str) and text["value"].strip():
                return text["value"].strip()
    raise ValueError(f"上游返回了响应但没有最终文本建议（output 类型：{', '.join(output_types) or '空'}）")


def _response_image_data(content: bytes, mime_type: str) -> str:
    try:
        with Image.open(io.BytesIO(content)) as opened:
            opened.load()
            image = opened.convert("RGB")
            image.thumbnail((768, 768), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, "JPEG", quality=84, optimize=True)
            content, mime_type = output.getvalue(), "image/jpeg"
    except Exception:
        pass
    return f"data:{mime_type};base64,{base64.b64encode(content).decode('ascii')}"


def optimize_prompt(
    *, base_url: str, api_key: str, model: str, prompt: str,
    style_prompt: str = "", settings: dict[str, object] | None = None,
    reference_images: list[tuple[str, bytes, str]] | None = None,
) -> str:
    references = reference_images or []
    context = [f"用户原始提示词：{prompt.strip()}"]
    if style_prompt.strip():
        context.append(f"用户选择的风格约束（必须保留其意图）：{style_prompt.strip()}")
    if settings:
        context.append("用户当前图片设置（不要擅自改动，除非提示词明确要求）：" + json.dumps(settings, ensure_ascii=False))
    context.append("请返回一条可以直接发送给图片模型的完整润色后提示词，只输出提示词正文，不要解释过程。")
    text_input = "\n\n".join(context)
    content = [{"type": "input_text", "text": text_input}]
    content.extend({"type": "input_image", "image_url": _response_image_data(data, mime)} for _name, data, mime in references)
    payload = {
        "model": model,
        "instructions": "你是图片提示词润色助手。保留主体、动作和意图，结合风格约束、图片设置与参考图补足可视化细节。不要擅自改变技术参数，不要添加无关内容。",
        "input": [{"role": "user", "content": content}],
        "max_output_tokens": 2048,
        "reasoning": {"effort": "low"},
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(trust_env=False, timeout=90) as client:
            response = client.post(api_endpoint(base_url, "responses"), headers=headers, json=payload)
            if references and response.status_code >= 400:
                fallback_content = [{"type": "input_text", "text": text_input + "\n参考图未能提供给文本模型，请仅依据文字完成润色。"}]
                response = client.post(api_endpoint(base_url, "responses"), headers=headers, json={**payload, "input": [{"role": "user", "content": fallback_content}]})
        response.raise_for_status()
        return _responses_text(response.json())
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError(f"提示词优化失败：{exc}") from exc


def complete_generation(
    *, db, asset_store, run_id: str, user_id: str, workspace_id: str,
    base_url: str, api_key: str, model: str, prompt: str, params: dict,
    reference_images: list[tuple[str, bytes, str]],
):
    try:
        outputs = generate_images(
            base_url=base_url, api_key=api_key, model=model, prompt=prompt,
            size=params["size"], quality=params["quality"], count=params["count"],
            background=params["background"], output_format=params["output_format"],
            output_compression=params["output_compression"], reference_images=reference_images,
        )
        upstream_sizes = [f"{item['upstream_size'][0]}x{item['upstream_size'][1]}" for item in outputs if item.get("upstream_size")]
        params["upstream_sizes"] = upstream_sizes
        params["size_adjusted_count"] = sum(value != params["size"] for value in upstream_sizes)
        saved_assets = [
            asset_store.save_generated(
                user_id=user_id, workspace_id=workspace_id, run_id=run_id,
                content=output["bytes"], mime_type=output["mime_type"],
            )
            for output in outputs
        ]
        with db.connect() as connection:
            connection.execute("UPDATE runs SET status='completed',params_json=? WHERE id=?", (json.dumps(params), run_id))
            connection.execute("UPDATE workspaces SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (workspace_id,))
    except Exception as exc:
        with db.connect() as connection:
            connection.execute("UPDATE runs SET status='failed',error=? WHERE id=?", (str(exc)[:1000], run_id))
            connection.execute("UPDATE workspaces SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (workspace_id,))


@router.post("/api/workspaces/{workspace_id}/generate", status_code=status.HTTP_202_ACCEPTED)
async def generate(
    workspace_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    provider_id: str = Form(...),
    model: str = Form(...),
    prompt: str = Form(...),
    size: str = Form("1024x1024"),
    quality: str = Form("high"),
    count: int = Form(1),
    background: str = Form("auto"),
    output_format: str = Form("png"),
    output_compression: int = Form(100),
    reference_asset_ids: list[str] = Form(default=[]),
    library_reference_ids: list[str] = Form(default=[]),
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
    if background not in {"auto", "transparent", "opaque"}:
        raise HTTPException(status_code=422, detail="背景参数不正确")
    if output_format not in {"png", "jpeg", "webp"}:
        raise HTTPException(status_code=422, detail="输出格式不正确")
    if output_compression < 0 or output_compression > 100:
        raise HTTPException(status_code=422, detail="压缩质量需为 0-100")
    try:
        validate_output_size(size)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    cited_asset_ids = list(dict.fromkeys(reference_asset_ids))
    stored_reference_ids = list(dict.fromkeys(library_reference_ids))
    if len(cited_asset_ids) + len(stored_reference_ids) + len(references) > MAX_REFERENCE_IMAGES:
        raise HTTPException(status_code=422, detail=f"参考图总数不能超过 {MAX_REFERENCE_IMAGES} 张")

    reference_images = []
    for asset_id in cited_asset_ids:
        asset = owned_asset(request, asset_id, user["id"])
        content = request.app.state.assets._safe_path(asset["path"]).read_bytes()
        extension = {"image/jpeg": "jpg", "image/webp": "webp"}.get(asset["mime_type"], "png")
        reference_images.append((f"asset-{asset_id}.{extension}", content, asset["mime_type"]))

    for asset_id in stored_reference_ids:
        asset = request.app.state.assets.get_reference(asset_id, user["id"])
        if not asset:
            raise HTTPException(status_code=404, detail="参考图库图片不存在")
        content = request.app.state.assets._safe_path(asset["path"]).read_bytes()
        extension = {"image/jpeg": "jpg", "image/webp": "webp"}.get(asset["mime_type"], "png")
        reference_images.append((f"reference-{asset_id}.{extension}", content, asset["mime_type"]))

    for upload in references:
        content = await upload.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="单张参考图不能超过 20MB")
        reference_images.append((upload.filename or "reference.png", content, upload.content_type or "image/png"))

    run_id = str(uuid.uuid4())
    params = {
        "size": size, "quality": quality, "count": count,
        "background": background, "output_format": output_format,
        "output_compression": output_compression,
        "reference_asset_ids": cited_asset_ids,
        "library_reference_ids": stored_reference_ids,
        "reference_count": len(reference_images),
    }
    with request.app.state.db.connect() as connection:
        connection.execute(
            """INSERT INTO runs(id,user_id,workspace_id,provider_id,model,prompt,params_json,status)
               VALUES(?,?,?,?,?,?,?,'running')""",
            (run_id, user["id"], workspace_id, provider_id, model, prompt.strip(), json.dumps(params)),
        )
    api_key = decrypt_secret(request.app.state.settings.encryption_key, provider["api_key_encrypted"])
    background_tasks.add_task(
        complete_generation,
        db=request.app.state.db,
        asset_store=request.app.state.assets,
        run_id=run_id,
        user_id=user["id"],
        workspace_id=workspace_id,
        base_url=provider["base_url"],
        api_key=api_key,
        model=model,
        prompt=prompt.strip(),
        params=params,
        reference_images=reference_images,
    )
    return {"id": run_id, "prompt": prompt.strip(), "model": model, "params": params, "status": "running", "assets": []}


@router.post("/api/workspaces/{workspace_id}/optimize")
async def optimize_rich(workspace_id: str, request: Request, user=Depends(get_current_user)):
    owned_workspace(request, workspace_id, user["id"])
    content_type = request.headers.get("content-type", "")
    references: list[tuple[str, bytes, str]] = []
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        provider_id = str(form.get("provider_id", ""))
        model = str(form.get("model", ""))
        prompt = str(form.get("prompt", ""))
        style_prompt = str(form.get("style_prompt", ""))
        settings = {key: str(form.get(key, "")) for key in ("size", "quality", "count", "background", "output_format", "output_compression") if form.get(key) is not None}
        reference_asset_ids = [str(value) for key, value in form.multi_items() if key == "reference_asset_ids"]
        library_reference_ids = [str(value) for key, value in form.multi_items() if key == "library_reference_ids"]
        uploads = [value for key, value in form.multi_items() if key == "references" and hasattr(value, "read") and hasattr(value, "filename")]
        for asset_id in reference_asset_ids[:MAX_REFERENCE_IMAGES]:
            asset = owned_asset(request, asset_id, user["id"])
            references.append((f"asset-{asset_id}.jpg", request.app.state.assets._safe_path(asset["path"]).read_bytes(), asset["mime_type"]))
        for asset_id in library_reference_ids[: max(0, MAX_REFERENCE_IMAGES - len(references))]:
            asset = request.app.state.assets.get_reference(asset_id, user["id"])
            if not asset:
                raise HTTPException(status_code=404, detail="参考图库图片不存在")
            references.append((f"reference-{asset_id}.jpg", request.app.state.assets._safe_path(asset["path"]).read_bytes(), asset["mime_type"]))
        for upload in uploads[: max(0, MAX_REFERENCE_IMAGES - len(references))]:
            references.append((upload.filename or "reference.jpg", await upload.read(), upload.content_type or "image/jpeg"))
    else:
        payload = OptimizeInput.model_validate(await request.json())
        provider_id, model, prompt, style_prompt, settings = payload.provider_id, payload.model, payload.prompt, "", None
    provider = owned_provider(request, provider_id, user["id"])
    if is_image_model(model):
        raise HTTPException(status_code=422, detail="当前模型是图片模型，请在设置中选择语言模型")
    api_key = decrypt_secret(request.app.state.settings.encryption_key, provider["api_key_encrypted"])
    try:
        suggestion = await run_in_threadpool(
            optimize_prompt,
            base_url=provider["base_url"], api_key=api_key, model=model, prompt=prompt,
            style_prompt=style_prompt, settings=settings, reference_images=references,
        )
        return {"suggestion": suggestion}
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
